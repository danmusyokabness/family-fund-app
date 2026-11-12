// scripts/check-done.mjs
//
// Checks that the Family Fund project is in its finished state. It changes
// nothing and prints no secrets. Run it from the project folder:
//
//     node scripts/check-done.mjs
//     node scripts/check-done.mjs --site=https://family-fund-app-nine.vercel.app
//
// It reports PASS / FAIL / SKIP for every check and exits with an error code
// when anything FAILS. (It does not run the tests or the build: run
// `npm test` and `npm run build` yourself, as the instructions say.)

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const siteArg = process.argv.find((a) => a.startsWith("--site="));
const SITE = (siteArg ? siteArg.slice(7) : "https://family-fund-app-nine.vercel.app").replace(/\/$/, "");

let fails = 0;
let skips = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg, hint) => {
  fails += 1;
  console.log(`  FAIL  ${msg}${hint ? `\n          -> ${hint}` : ""}`);
};
const skip = (msg) => {
  skips += 1;
  console.log(`  SKIP  ${msg}`);
};
const section = (title) => console.log(`\n${title}`);
const check = (ok, msg, hint) => (ok ? pass(msg) : fail(msg, hint));
const read = (p) => readFileSync(join(root, p), "utf8");

function walk(dir, out = []) {
  const full = join(root, dir);
  if (!existsSync(full)) return out;
  for (const name of readdirSync(full)) {
    const rel = `${dir}/${name}`;
    const s = statSync(join(root, rel));
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

function git(cmd) {
  try {
    return execSync(`git ${cmd}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

if (!existsSync(join(root, "package.json"))) {
  console.log("Run this from the project folder (the one that contains package.json).");
  process.exit(2);
}

// ---------------------------------------------------------------------------
section("1. Files that must be gone (removed features)");
const mustBeGone = [
  ["lib/sms.ts", "the Africa's Talking sender"],
  ["lib/africastalking.d.ts", "its type file"],
  ["lib/admin-alerts.ts", "the SMS admin alerts"],
  ["tests/sms.test.ts", "its tests"],
  ["app/api/admin/sms-log/route.ts", "the SMS log route"],
  ["components/PayHelper.tsx", "the pay helper"],
  ["lib/pay.ts", "the pay helper maths"],
];
for (const [file, what] of mustBeGone) {
  check(!existsSync(join(root, file)), `${file} is gone (${what})`, `run: git rm ${file}`);
}

section("2. Files that must be there (finished features)");
const mustExist = [
  "lib/cancel-out.ts",
  "app/api/admin/cancel-out/route.ts",
  "components/admin/CancelOutPanel.tsx",
  "lib/onboarding.ts",
  "lib/access.ts",
  "components/TreeOnboarding.tsx",
  "components/ProfileFields.tsx",
  "components/tree-common.tsx",
  "app/api/tree/onboard/route.ts",
  "db/008_erase_cancelled.sql",
  "db/009_family_profile.sql",
];
for (const file of mustExist) check(existsSync(join(root, file)), `${file} is there`, "unpack the latest zip over the project");

section("3. Africa's Talking is gone from the code and the packages");
const pkg = read("package.json");
check(!/"africastalking"/.test(pkg), "package.json no longer lists africastalking", "run: npm uninstall africastalking");
check(!/tests\/sms\.test\.ts/.test(pkg), "the test script no longer lists tests/sms.test.ts", "re-unpack the latest zip (it fixes package.json) then run npm uninstall africastalking");
if (existsSync(join(root, "package-lock.json"))) {
  check(!/node_modules\/africastalking/.test(read("package-lock.json")), "package-lock.json no longer lists africastalking", "run: npm uninstall africastalking");
}
const leftovers = [];
for (const dir of ["app", "lib", "components"]) {
  for (const file of walk(dir)) {
    if (/africastalking|SMS_LIVE|AT_API_KEY|AT_USERNAME|AT_SENDER_ID|sendSms\(/i.test(read(file).replace(/Africa's Talking was removed/g, ""))) leftovers.push(file);
  }
}
check(leftovers.length === 0, "no source file mentions the SMS provider or its settings", leftovers.join(", "));

section("4. Secrets are kept out of the repository");
const ignore = existsSync(join(root, ".gitignore")) ? read(".gitignore") : "";
check(/^\.env\*/m.test(ignore) || /^\.env\.local/m.test(ignore), ".gitignore ignores .env.local", "add .env* to .gitignore");
const tracked = git("ls-files .env.local .env .env.production");
if (tracked === null) skip("not a git repository here, so tracked files could not be checked");
else check(tracked === "", "no .env file is tracked by git", `tracked: ${tracked}. Run: git rm --cached .env.local, then rotate every secret in it`);

section("5. Git: everything saved and uploaded");
const status = git("status --porcelain");
if (status === null) skip("not a git repository here");
else {
  check(status === "", "no unsaved changes", `uncommitted: ${status.split("\n").length} file(s). Run: git add -A, git commit, git push`);
  const upstream = git("rev-parse --abbrev-ref @{u}");
  if (!upstream) skip("no upstream branch set, so 'pushed' could not be checked");
  else {
    git("fetch --quiet");
    const ahead = git(`rev-list --count ${upstream}..HEAD`);
    const behind = git(`rev-list --count HEAD..${upstream}`);
    check(ahead === "0", "everything committed has been pushed", `${ahead} commit(s) not pushed. Run: git push`);
    check(behind === "0", "nothing newer is waiting online", `${behind} commit(s) online that you do not have. Run: git pull`);
  }
}

section("6. Database (reads your .env.local; shows no secrets)");
let env = {};
for (const name of [".env.local", ".env"]) {
  if (existsSync(join(root, name))) env = { ...env, ...parseEnv(read(name)) };
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  skip("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in .env.local, so the database could not be checked");
} else {
  const ask = async (path) => {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      return { status: res.status, body: await res.text() };
    } catch (err) {
      return { status: 0, body: String(err.message ?? err) };
    }
  };
  const probes = [
    ["db/008", "the erased-receipts table exists", "import_skip_receipts?select=mpesa_receipt&limit=1"],
    ["db/009", "family_nodes has education, work, residence and profile_completed_at", "family_nodes?select=education,work,residence,profile_completed_at&limit=1"],
    ["db/009", "members has the contributes column", "members?select=contributes&limit=1"],
  ];
  for (const [file, what, path] of probes) {
    const r = await ask(path);
    if (r.status === 0) skip(`${what}: could not reach the database (${r.body})`);
    else check(r.status === 200, what, `run ${file}_*.sql in the Supabase SQL Editor`);
  }
  const old = await ask("job_runs?select=id&job=eq.cancel_out&limit=1");
  if (old.status === 200) check(old.body.trim() === "[]", "no old cancel-out records are left in job_runs", "run db/008 again in the Supabase SQL Editor");
  const hanging = await ask("members?select=id&contributes=eq.true&is_active=eq.true&limit=1");
  if (hanging.status === 200) check(hanging.body.trim() !== "[]", "at least one active contributing member exists", "check the Members tab");
}

section(`7. The live site answers sanely (${SITE})`);
async function probe(path, wanted, what) {
  try {
    const res = await fetch(`${SITE}${path}`, { redirect: "manual" });
    check(wanted.includes(res.status), `${what} -> ${res.status}`, `expected ${wanted.join(" or ")}. A 500 means the deployed version is broken: look at Vercel > Logs`);
  } catch (err) {
    skip(`${what}: could not reach ${SITE} (${String(err.message ?? err)})`);
  }
}
await probe("/login", [200], "login page loads");
await probe("/api/dashboard", [401], "dashboard refuses a visitor who is not logged in");
await probe("/api/tree", [401], "family tree refuses a visitor who is not logged in");
await probe("/api/admin/members", [401, 403], "admin members refuses a visitor who is not logged in");
await probe("/api/admin/cancel-out", [401, 403], "cancel-out refuses a visitor who is not logged in");

// ---------------------------------------------------------------------------
console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : `${fails} CHECK(S) FAILED`}${skips ? `  (${skips} skipped)` : ""}`);
console.log("Still to do by hand: npm test, npm run build, and the click-through list in the instructions.");
process.exit(fails === 0 ? 0 : 1);
