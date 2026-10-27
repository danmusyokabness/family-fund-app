import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken } from "../lib/session-token.ts";

const SECRET = "test-secret-do-not-use-in-real-life";

test("a token round-trips back to its original payload", () => {
  const token = createSessionToken({ kind: "member", memberId: "abc-123" }, SECRET);
  const payload = verifySessionToken<{ kind: string; memberId: string }>(token, SECRET);
  assert.deepEqual(payload, { kind: "member", memberId: "abc-123" });
});

test("a token verified with the wrong secret is rejected", () => {
  const token = createSessionToken({ kind: "admin" }, SECRET);
  assert.equal(verifySessionToken(token, "a-different-secret"), null);
});

test("a tampered payload is rejected", () => {
  const token = createSessionToken({ kind: "member", memberId: "abc-123" }, SECRET);
  const [payloadPart, sigPart] = token.split(".");
  const tamperedPayload = Buffer.from(
    JSON.stringify({ kind: "member", memberId: "someone-elses-id" })
  ).toString("base64url");
  const tampered = `${tamperedPayload}.${sigPart}`;
  assert.equal(verifySessionToken(tampered, SECRET), null);
});

test("an expired token is rejected", () => {
  const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
  const token = createSessionToken({ kind: "member", exp: oneHourAgo }, SECRET);
  assert.equal(verifySessionToken(token, SECRET), null);
});

test("a token that has not expired yet is accepted", () => {
  const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
  const token = createSessionToken({ kind: "member", exp: oneHourFromNow }, SECRET);
  assert.notEqual(verifySessionToken(token, SECRET), null);
});

test("a payload with no exp field never expires", () => {
  const token = createSessionToken({ kind: "member" }, SECRET);
  assert.notEqual(verifySessionToken(token, SECRET), null);
});

test("garbage input is rejected without throwing", () => {
  assert.equal(verifySessionToken("", SECRET), null);
  assert.equal(verifySessionToken("not-a-real-token", SECRET), null);
  assert.equal(verifySessionToken("a.b.c", SECRET), null);
  assert.equal(verifySessionToken("!!!.???", SECRET), null);
});
// ---------------------------------------------------------------------
// Security guards. These read the project's own source files, so a future
// change that quietly removes a lock fails the test run.
// ---------------------------------------------------------------------
import { existsSync, readdirSync as listDir, readFileSync as readText } from "node:fs";
import { fileURLToPath as toPath } from "node:url";

const API_DIR = toPath(new URL("../app/api/", import.meta.url));
const read = (relative: string) => readText(toPath(new URL(`../${relative}`, import.meta.url)), "utf8");
const routeFiles = (): string[] =>
  (listDir(API_DIR, { recursive: true }) as string[]).filter((f) => f.replace(/\\/g, "/").endsWith("route.ts")).map((f) => f.replace(/\\/g, "/"));

// The only API routes that are meant to be open to anyone. Everything else must check who is asking.
const PUBLIC_ROUTES = ["auth/admin-login/route.ts", "auth/member-login/route.ts", "auth/logout/route.ts", "health/route.ts"];
const GUARD = /requireSuperAdmin|requireAdmin|requireMember|getMemberSession|getAdminSession|getAdminContext|getActor|isCronCall/;

test("security: every API route checks who is asking, except the few meant to be public", () => {
  const routes = routeFiles();
  assert.ok(routes.length >= 15, "the scan should find the API routes");
  for (const route of routes) {
    if (PUBLIC_ROUTES.includes(route)) continue;
    assert.ok(GUARD.test(read(`app/api/${route}`)), `app/api/${route} has no access check`);
  }
});

test("security: every route under /api/admin requires an admin, and the sensitive ones need the superadmin", () => {
  for (const route of routeFiles().filter((r) => r.startsWith("admin/"))) {
    assert.ok(/requireSuperAdmin|requireAdmin/.test(read(`app/api/${route}`)), `app/api/${route} must use requireAdmin or requireSuperAdmin`);
  }
  assert.ok(read("app/api/admin/export/route.ts").includes("requireSuperAdmin"), "backups contain phone numbers: superadmin only");
  assert.ok(read("app/api/admin/reset-test-data/route.ts").includes("requireSuperAdmin"), "wiping data: superadmin only");
});

test("security: wiping test data is locked behind a setting that is OFF by default", () => {
  const route = read("app/api/admin/reset-test-data/route.ts");
  assert.ok(route.includes("allowTestDataReset"), "the reset route must check ALLOW_TEST_DATA_RESET");
  assert.ok(route.includes("DELETE ALL TEST DATA"), "the reset route must still need the typed phrase");
  assert.ok(/optionalBoolean\("ALLOW_TEST_DATA_RESET", false\)/.test(read("lib/env.ts")), "the switch must default to off");
});

test("security: the public health page shows details only to a logged-in admin", () => {
  const route = read("app/api/health/route.ts");
  assert.ok(route.includes("getAdminSession"));
  assert.ok(/if \(!isAdmin\)/.test(route), "non-admins must get the short answer");
});

test("security: the site sends its protective headers, and secret files are never committed", () => {
  const config = read("next.config.ts");
  for (const header of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy", "Strict-Transport-Security", "frame-ancestors 'none'", "X-Robots-Tag"]) {
    assert.ok(config.includes(header), `next.config.ts must send ${header}`);
  }
  const ignore = read(".gitignore");
  assert.ok(/^\.env\*/m.test(ignore), ".gitignore must ignore every .env file");
  assert.ok(/^!\.env\.example/m.test(ignore));
});

test("security: no password fallback or pasted key is written into the application code", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = toPath(new URL(`../${dir}/`, import.meta.url));
    for (const file of listDir(root, { recursive: true }) as string[]) {
      if (!/\.(ts|tsx|js)$/.test(file)) continue;
      const text = readText(`${root}${file}`, "utf8");
      if (/admin123|eyJ[A-Za-z0-9_-]{30,}|sk_live_|-----BEGIN [A-Z ]*PRIVATE KEY/.test(text)) offenders.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("security: the family tree hides what people chose to hide, only lets people edit their own family circle, and the chat only returns what involves the member", () => {
  const tree = read("app/api/tree/route.ts");
  assert.ok(tree.includes("viewForViewer(n, ctx.editable.has(n.id))"), "every node must go through viewForViewer with the viewer's edit rights");
  assert.ok(tree.includes("addChildTargets.has(parentId)"), "a member may only add under themselves or their parent");
  const edit = read("app/api/tree/[id]/route.ts");
  assert.ok(edit.includes("ctx.editable.has(id)"), "editing must check the viewer's edit rights");
  assert.ok(edit.includes("Only an admin can move someone"), "only an admin may move a person to a different parent");
  assert.ok(read("app/api/tree/[id]/photo/route.ts").includes("ctx.editable.has(id)"), "photos follow the same edit rights");
  const chat = read("app/api/chat/route.ts");
  assert.ok(chat.includes("visibleToMember"), "every chat row must be checked with visibleToMember");
  assert.ok(chat.includes("recipient_member_id.eq."), "the private query must ask only for rows that involve this member");
  assert.ok(/to_admin\.eq\.true,is_from_admin\.eq\.true/.test(chat), "the admin inbox must be limited to messages to or from the admin");
});

test("security: the removed features stay removed (change log, undo, the board page and the old board and inbox routes)", () => {
  const root = toPath(new URL("../", import.meta.url));
  for (const gone of ["app/api/tree/history", "app/api/admin/tree", "app/api/board", "app/api/admin/board", "app/board", "components/MessageBoard.tsx", "components/admin/BoardInbox.tsx"]) {
    assert.equal(existsSync(`${root}${gone}`), false, `${gone} should have been deleted (run: git rm -r ${gone})`);
  }
  assert.ok(!read("lib/family-tree.ts").includes("planUndo"), "the undo logic should be gone");
});

test("security: a member's own place in the tree can never be removed, and a removal is never permanent", () => {
  const route = read("app/api/tree/[id]/route.ts");
  assert.ok(route.includes("node.memberId"), "removing a member's own entry must be refused");
  assert.ok(route.includes("deleted_at"), "removal must be a soft delete");
  assert.ok(!/\.delete\(\)/.test(route), "the tree route must never hard-delete a row");
});

test("compatibility: no regular expression uses a flag or feature newer than the project's ES2017 setting (it broke a build once)", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = toPath(new URL(`../${dir}/`, import.meta.url));
    for (const file of listDir(root, { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readText(`${root}${file}`, "utf8");
      // a regex literal ending in the "s" (dot-all) flag and then used, or a look-behind, or a named group
      if (/\/[gimuy]*s[gimuy]*\.(exec|test|match)\(/.test(text.replace(/\/[^/\n]*\/(?![gimuy]*s)/g, "")) || /\(\?<[=!]/.test(text) || /\(\?<[A-Za-z]/.test(text)) {
        offenders.push(`${dir}/${file}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "use [\\s\\S] instead of the s flag, and avoid look-behind or named groups");
});
