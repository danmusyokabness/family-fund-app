# Family Emergency Fund Platform: Handover README (v9.7, 11 Nov 2026)

> **This file is the single source of truth for continuing the project with any AI agent or developer.** It describes the app, the owner, the rules, the exact state of the work, and what to do next. **The code is the truth for what is implemented; this file is the truth for intent, decisions and rules.** Verify this README against the real code before changing anything.

---

## 0. START HERE (how to resume in a new chat)

1. Ask the owner to attach: **(a)** this README, **(b)** a fresh **zip of the project folder** (no `node_modules`, no `.next`, **never `.env.local`**), **(c)** a current **Supabase schema export** (the "CREATE TABLE" listing, as `.sql`), and **(d)** any screenshots or error text.
2. Ask which **delivery zips and SQL files the owner has actually applied** (section 3.3 lists what exists and what is unconfirmed). Trust the zip they upload over any assumption.
3. Say: *"Continue this project. Read the README first, then check it against the actual code and tell me what is left."* Then follow **section 14 (the next work)**.
4. **Never ask the owner to paste a real secret** (Supabase service key, admin password, session secrets). They live only in Vercel Environment Variables and the local `.env.local`.
5. The sandbox you work in probably **cannot** run `next build`, run SQL, or open a real PDF. The owner's `npm run build` and the Supabase SQL editor are the real tests (section 13).

---

## 1. WHAT THIS APP IS

A private web app for a **family emergency fund** that started **August 2026**:

* Working family members each owe **KES 300 a month** (`target_amount`, editable in Setup) paid to **M-PESA Till 1611383** (the statement shows store/shortcode 1138423; customers pay the Till).
* **Financial year** = 1 August to 31 July. About **16 contributing members**.
* One shared site. Members log in and see their own balance, the month-by-month ledger of everyone's contributions, the family tree and a chat. One admin runs it.
* The app should **run itself**: stay awake (Supabase free tier pauses after ~7 idle days), text arrears reminders on the 7th and a fund report on the 15th, warn the admin when payment data is stale, and keep the books reconciled with the M-PESA balance.
* Payments reach the app by **uploading the M-PESA statement** (PDF with password, or CSV). Automatic intake is wanted but **Daraja was dropped by the owner** (section 14, item 9).

Live at `https://family-fund-app-nine.vercel.app` (Vercel). GitHub: `github.com/danmusyokabness/family-fund-app` (private).

---

## 2. THE OWNER AND HOW TO WORK WITH THEM

* **Non-technical.** Works on **Windows** (Command Prompt, Chrome, Notepad). Needs **precise click-by-click, copy-paste instructions every time**, every command in its **own code block**, assuming no background. Never write "as before".
* Be **honest about what could not be verified**. The owner reports back with pasted terminal output and screenshots; real bugs have been found that way (several are in section 12).
* Decisions are theirs: **recommend with pros and cons**, do not decide silently. Ask **at most one question at a time**, and do not stall on questions that do not block.
* The chat tool cannot upload encrypted PDFs; they can only upload decrypted (picture-only) copies, which cannot be read by any program.
* **Delivery format they asked for (use it every time):** a cumulative **zip** with real folder paths that extracts at the project root, and a message with these parts:

  1. **What changed / what it adds** (plain words).
  2. **Apply it, in this order**: *1. Database first* (only if there is new SQL: SQL Editor, New query, paste, Run, what success looks like). *2. Code (cmd, from the project folder)*: `git pull`, then `tar -xf "%USERPROFILE%\Downloads\<zip>" -C .`, `npm test`, `npm run build`, `git status` (check `.env.local` is NOT listed), `git add -A`, `git commit -m "..."`, `git push`. *3. Deploy*: Vercel deploys itself; wait about two minutes for **Ready**.
  3. **What to test once it's live** (numbered, concrete).
  4. **After it works / what is next.**
* The zip **cannot delete files**. When code is removed, give `git rm -r --ignore-unmatch <paths>` commands to run before extracting, and add a guard test that fails if the removed paths still exist.
* **Never overwrite the owner's `package.json`** (they installed `unpdf`; scripts list test files explicitly). If a new test file is needed, **append the tests to an existing file already in the `test` script** instead.
* Every zip should also carry the updated **README.md** (and `docs/GO-LIVE.md` if the owner steps changed).

---

## 3. CURRENT STATE

### 3.1 Delivered and working (as of v8.2, 303 tests)

| Area | Status |
|---|---|
| Login (members by name + phone, admin by env credentials, member-admins), throttling, cookies | ✅ |
| Setup, Members (phones, alternates, till numbers, masked statement numbers, admin manual order, CSV import that merges into existing members) | ✅ |
| Payments: matching queues, manual payments, **payment types** (monthly / booster / recovery / donation / other income), splits | ✅ |
| Statement import: **PDF (password typed in the box) and CSV**, balance integrity check, preview shows the member each payment would match | ✅ proven end to end on a real statement |
| Member dashboard: balance cards, month-by-month ledger (monthly contributions only), **Other income and notes** section, "Show full ledger" link | ✅ |
| **Full ledger** page (every movement, categories, running balance equals Total in account) | ✅ |
| Reminders (7th) and fund report (15th): a list of who should get what, with the exact wording and a **WhatsApp** button (and Copy text) per member; the admin sends them by hand. **No text-message provider** (Africa's Talking removed in v9.4). The daily cron only keeps the database awake | ✅ v9.4 |
| Health tab (daily job, data age, texting mode, waiting payments, members without a phone, backup age, "Total in account matches M-PESA", unread chat messages), backup + CSV exports (superadmin only) | ✅ |
| Hardening: every route checks who is asking, locked data-reset, minimal public health page, security headers, `db/005` RLS lock, `docs/GO-LIVE.md` | ✅ |
| **Family tree** drawn as a real tree: photo cards, parent-child lines, **fit to screen + zoom bar/buttons + scrollbars, colour per generation**, details panel, add/edit with privacy toggles, photo upload, "Where are you in the family?" first-visit step | ✅ delivered in v8.1/v8.2 |
| **Cancel out** (Payments tab): erase a withdrawal, the deposit(s) that put it back and the M-PESA fee on those deposits, in one step, with the Total in account unchanged and no trace left (a few cents of rounding stay as one plain "Rounding" line). The tool is shown to and usable by the superadmin only | ✅ v9.3 (needs `db/008`) |
| **Chat** (floating button: Everyone / a member privately / the Admin; admin inbox in the same widget; text to admin on a private message) | ✅ |

### 3.2 Family tree: profile libraries (v9.1) now wired in by v9.5

Delivered in `cancel-out-17.zip` together with the cancel-out feature (they change nothing the owner sees):

* **Bug fix in `lib/family-tree.ts`:** `sanitizeNodePatch` now treats a key whose value is `undefined` as "not sent". That was the cause of "Spouse name must be text. Work / education must be text. Bio must be text." on the join form (the connect route builds an object with undefined values). A regression test covers it.
* `lib/profile.ts` (new): structured education / work / residence entries, validators (`sanitizeEducation`, `sanitizeWork`, `sanitizeResidence`) and readable-line helpers (`describeEducation`, `describeWork`, `describeResidence`).
* `lib/data/places.ts` (new): countries (Kenya first), Kenya's 47 counties, `regionsFor`. `lib/data/careers.ts` (new): education levels, work statuses, sectors, Kenyan institutions, job titles.
* Tests for these are appended to `tests/family-tree.test.ts`.

**Built in v9.5 (`tree-first-visit-21`, needs `db/009`):** `TreeNode`/`TreeRow`/`NodePatch` carry `education`, `work`, `residence` and `profileCompletedAt`; `HIDEABLE_FIELDS` includes `education`, `work`, `residence`; `changedFields` compares lists exactly; `viewForViewer` blanks hidden lists to `[]` and residence to `null`; `needsProfile`; `lib/onboarding.ts` (`planOnboarding`: the required details and parent rules); `POST /api/tree/onboard`; `components/TreeOnboarding.tsx` (the first-visit form), `components/ProfileFields.tsx` (the three structured editors, used there and in the edit form), `components/tree-common.tsx` (shared helpers). **Also built in v9.6:** the My information section, the family's own entries as suggestions, siblings with only an approximate birth ordered by that year (`birthKey`), family-only members. **Not built, by the owner's decision:** item 9 (automatic payment intake) and item 10 (STK Push, parked).

### 3.3 What the owner has applied (UNCONFIRMED: ask)

Delivered zips in order (each later one is cumulative over the earlier ones unless noted): `batch-1` (db 001-004, SMS fix, PDF reader, member ordering), `all-fixes-combined`, `reminders-6`, `ledger-and-messages-7`, `admin-complete-8`, `alerts-9`, `hardening-10`, `payment-purposes-11`, `other-income-12`, `tree-and-board-13`, `tree-chat-14`, `fix-photo-regex-15`, `tree-zoom-colour-16`, `fix-join-form-17`, `erase-cancelled-18`, `hanging-fee-19`, `no-sms-20`, `tree-first-visit-21`, `finish-22`, `remove-payhelper-23`. From a screenshot the owner has deployed **at least `tree-chat-14`**. SQL files `db/005`, `db/006`, `db/007` were requested, and **`db/008` (erase cancelled) is new in v9.2**; **confirm they ran** (compare the schema export with section 6). Also unconfirmed: secrets rotated (the very first zip contained `.env.local`), `git rm -r legacy` (confirmed done). Vercel variables `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID`, `SMS_LIVE` should be deleted (nothing reads them now); and `npm uninstall africastalking` should be run once.

### 3.4 Owner decisions pending / open questions

* **Parents:** the tree has ONE parent link per person (`parent_id`); the other parent is shown on the card as the "spouse" text. The owner said "parents" are mandatory. Ask whether one parent link is enough or both parents must be separate entries (that would need a second link).
* **Payment text samples** for the free automatic intake (section 14, item 9). Still waiting.
* **Old fee rows (11 Nov 2026):** before v9.2, cancel-out refused M-PESA charges, so the fee on a put-back deposit stayed on the books and members saw it as an unexplained charge. **Handled in v9.3** as a "hanging fee": the Cancel out tool lists it on the withdrawal side, to be erased with a deposit paid in to cover it (owner's case: deposit 105 against a fee of 93 leaves 12 as other income). A hanging fee with no covering deposit stays a real cost (erasing it would move the Total in account).
* **Africa's Talking removed (11 Nov 2026):** the reminder texts failed with 401, then (after fixing the login) every number returned `UserInBlacklist` (406) on the shared route, and the fix was a paid sender ID, so the owner decided to remove it. Do not reintroduce a paid SMS provider without the owner. The free route is the WhatsApp button. Removed: `lib/sms.ts`, `lib/admin-alerts.ts`, `lib/africastalking.d.ts`, `/api/admin/sms-log`, `POST /api/admin/messages`, `sendMessages`, the SMS part of the daily cron, the admin alert and private-message texts, the Setup field `admin_alert_phone`, the Health SMS and import-alert lines, the env vars `AT_*` and `SMS_LIVE`. Kept: the `sms_log` table and its history (no longer written), the plan/preview, the stale-data warning.
* Click-to-pay: the owner asked for an M-PESA prompt with a pre-filled amount. That is an STK Push (a Daraja API); see section 14, item 8.

---

## 4. TECH STACK AND ENVIRONMENT

| Layer | Choice |
|---|---|
| Framework | **Next.js 16.4.2** (App Router, Turbopack), **React 19**, TypeScript strict |
| **TypeScript target** | **ES2017** (`tsconfig.json`). **A regex literal may NOT use the `s` flag, look-behind or named groups** (it broke a build once; a test guards it). Use `[\s\S]` |
| Styling | Tailwind 4 + CSS variables in `app/globals.css` (section 11) |
| Database | **Supabase Postgres**, accessed **only server-side** with the service-role key |
| Hosting | **Vercel Hobby** (one cron job, at most once a day) |
| Messages | none sent by the app; WhatsApp links (`wa.me`) opened by the admin |
| PDF | **`unpdf`** (serverless pdf.js; replaced `pdf.js-extract`, which failed on Vercel with a missing worker file) |
| Tests | Node's built-in runner: `node --test` on `.ts` files (Node 22+). The `test` script in `package.json` **lists each file explicitly** |
| Auth | Own HMAC-SHA256 signed cookies (`lib/session-token.ts`), no auth library |

`AGENTS.md` in the repo says this Next.js version has breaking changes and to read `node_modules/next/dist/docs/` before writing Next-specific code. **Obey it.** `CLAUDE.md` just imports it.

**Environment variables** (read only through `lib/env.ts`; changing one on Vercel needs a **redeploy**):

| Name | Secret | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | The `service_role` key (a past bug: the `anon` key pasted here) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | yes | Superadmin login |
| `SESSION_SECRET` | yes | Signs cookies |
| `CRON_SECRET` | yes | Vercel sends it to `/api/cron/daily` |
| `ALLOW_TEST_DATA_RESET` | no | `true` temporarily enables the superadmin "clear test data" button; leave off |

Business settings (Till, target, days, wording, thresholds, alert phone, site address) live in the **Setup page** (`settings` table; schema in `lib/settings.ts`), not env vars.

---

## 5. FILE MAP (as of v8.3)

```
db/001_schema.sql                 base schema, NON-destructive, safe to re-run
db/002_add_member_admin.sql       members.is_admin
db/003_family_tree_links.sql      family_nodes.member_id, date_of_birth
db/004_tree_board_hardening.sql   members.sort_order, tree soft delete, family_node_history, board columns
db/005_security_check.sql         RLS on every table, anon access revoked, proof table
db/006_payment_purpose.sql        payments.purpose, related_expense_id
db/007_tree_privacy_chat.sql      tree: hidden_fields, photo, has_photo, spouse_details; chat: recipient_member_id, to_admin
db/009_family_profile.sql         family_nodes education/work/residence/profile_completed_at; members.contributes (used for family-only members since v9.6)
db/008_erase_cancelled.sql        import_skip_receipts (erased M-PESA receipt numbers, nothing else); copies receipts from old cancel_out records into it, then deletes those records
docs/GO-LIVE.md                   beginner go-live steps, monthly routine, troubleshooting
AGENTS.md CLAUDE.md .env.example .gitignore next.config.ts (security headers) vercel.json (cron 0 5 * * *) tsconfig.json package.json

lib/ (pure unless marked SERVER)
  env.ts supabase.ts(SERVER) auth.ts(SERVER) actors.ts(SERVER) session-token.ts
  dates.ts           Nairobi time, months, financial year
  phone.ts           normalise phones; masked-number matching (canonicalMaskedPhone)
  ledger.ts          FIFO ledger engine
  dashboard.ts       the cards + ledger grid (group figures)
  member-order.ts    ONE ordering rule for members (age, then admin order, then name)
  payment-purpose.ts what a payment is for
  payment-matching.ts payer -> member matching
  statement-parser.ts statement-csv.ts pdf-statement-line.ts pdf-table.ts pdf-statement.ts(SERVER, unpdf)
  members-import.ts  member CSV parsing + merge planning
  full-ledger.ts     the full ledger + "other income" summary + balanceAsOf
  onboarding.ts      rules for the first-visit details form (date of birth + parent required)
  cancel-out.ts      rules for cancelling out a withdrawal + the deposit(s) that put it back + the fee on those deposits (deposit - fee = withdrawal, a few cents of rounding allowed)
  ledger-data.ts(SERVER) loads full-ledger inputs
  settings.ts        setting schema, defaults, validation
  message-templates.ts reminders.ts report.ts messaging.ts(SERVER: plans the monthly messages, sends nothing)
  health.ts export.ts pagination.ts load-members-for-matching.ts csv.ts canvas-stub.js
  family-tree.ts     tree rules (edit rights, hidden details, ranks, zoom/generations helpers)
  profile.ts data/places.ts data/careers.ts   structured education/work/residence (pure, NOT yet wired)
  tree-photo.ts      photo validation   tree-data.ts(SERVER) load nodes + edit context
  board.ts           chat rules (conversations, privacy, rate limit)

app/ pages:  / (dashboard)  /login  /admin  /admin/login  /ledger  /tree
app/api/:
  auth/{member-login,admin-login,logout,me}   dashboard   ledger/full   health (public, minimal)
  chat (GET/POST/PATCH)  chat/[id] (DELETE)
  tree (GET/POST)  tree/[id] (PATCH/DELETE)  tree/[id]/photo (GET/PUT/DELETE)  tree/connect  tree/parent
  cron/daily
  admin/{settings,members,members/[id],members/import,members/reorder,payments,payments/[id],
         fund-expenses,statements/import,messages,health,export,reset-test-data,cancel-out}

components/: AppNav ChatWidget FamilyTree FullLedger LogoutButton MemberDashboard OtherIncomeNotes
components/admin/: AdminShell(tabs: Members Payments Import Reminders Health Setup + floating chat)
                   MembersManager PaymentsManager CancelOutPanel StatementImport Reminders HealthPanel SetupForm
tests/ (19 files; the package.json "test" script lists each):
  dates phone ledger session-token(security guards) csv members-import settings payment-matching dashboard
  statement-parser pdf-statement-line statement-csv reminders(messaging+health) pdf-table
  member-order report board family-tree
```

**Rules for the code:** every page that must not be pre-built has `export const dynamic = "force-dynamic";`; files must be named exactly `page.tsx` / `route.ts`; every route guards itself (`requireAdmin` / `requireSuperAdmin` / `getMemberSession` / `getAdminContext` / `getActor` / cron secret); the guard test scans for this.

---

## 6. DATABASE (live schema)

All tables have **RLS enabled and no policies**; the public anon key reads nothing. Only server code with the service-role key touches data. Balances are **calculated, never stored**.

| Table | Key columns and rules |
|---|---|
| `settings` | `key` PK, `value`, `updated_at` |
| `members` | `id`, `full_name`, `joined_on` (**must be the 1st of a month**), `is_active`, `notes`, `is_admin`, `sort_order` (admin's manual position when birth date unknown). *Planned:* `contributes` boolean |
| `member_phones` | `member_id`, `phone_number` (**unique**, `^254[17][0-9]{8}$`), `is_primary` (one primary per member) |
| `payer_aliases` | `member_id`, `alias_type` (`masked_phone` = a statement number like `254110***358`, standard form; `shortcode` = a till/paybill number; `payer_name`), `alias_value`, `source` (`admin`/`confirmed`/`import`) |
| `payments` | `amount` ≠ 0, `kind` (`mpesa`/`manual`/`adjustment`/`opening`), **`source` only `statement`/`daraja`/`admin`** (writing `pdf` once rejected every payment), `mpesa_receipt` (unique), payer fields, `paid_at`, `match_status` (`matched`/`needs_confirmation`/`unmatched`/`ignored`), `suggested_member_id`, `import_id`, `raw`, **`purpose`** (`monthly` default / `booster` / `recovery` / `donation` / `other`), `related_expense_id` |
| `payment_allocations` | `payment_id`, `member_id`, `amount`. **A payment with no allocation is not credited to anyone** (but still counts in Total in account) |
| `fund_expenses` | `kind` (`charge`/`withdrawal`/`other`), `amount` > 0, `occurred_at`, `description`, `import_id` |
| `imports` | one row per statement upload; counts, reported vs calculated closing balance, `integrity_ok`, `period_start`, `period_end` (set from this version on) |
| `sms_log` | **history only: nothing writes to it since v9.4**; `kind` (`reminder`/`report`/`test`), `period` (`YYYY-MM`), `status` (`dry_run`/`sent`/`failed`/`skipped`); **a unique index allows only one `sent` per kind+period+member** |
| `import_skip_receipts` | `mpesa_receipt` unique, `created_at`. **Receipt numbers only** (no amounts, no names). Written by cancel-out; the statement import treats any receipt on it as already recorded. Never shown, never in the backup export; cleared by the test-data reset |
| `job_runs` | `job` (`daily`, `export`), `started_at`, `ok`, `details` (json) |
| `login_attempts` | throttling (5 failures lock 15 minutes) |
| `message_board` | the chat. `member_id` (the sender; for the admin's reply, the member it is for), `sender_name`, `content`, `is_private`, `is_from_admin`, `to_admin`, `recipient_member_id`, `read_at`, `deleted_at` |
| `family_nodes` | `name`, `spouse_name`, `spouse_details`, `parent_id`, `spouse_id`, `member_id` (unique per live node), `date_of_birth`, `birthdate` (approximate text), `work_education`/`bio` (old free text, legacy), `phone`, `hidden_fields text[]`, `photo` (small JPEG as text), `has_photo`, `deleted_at`, `updated_at`, `created_by_member_id`. *Planned:* `education jsonb`, `work jsonb`, `residence jsonb` |
| `family_node_history` | **no longer written** (change log removed); table kept |

**SQL rules (owner requirement):** every SQL file must be **safe to run twice and never destructive** (`create ... if not exists`, `add column if not exists`, guarded `do $$` blocks, never `drop`/`truncate`/`delete`). Number files in order, header comment with what it does and "safe to re-run", end with a **check query that returns `true` values**. Tell the owner: SQL Editor, New query, paste, Run, and what success looks like. **Run SQL BEFORE deploying code that reads new columns** (it caused an outage once).

**PostgREST trap:** `members` and `family_nodes` are linked by **two** foreign keys (`member_id`, `created_by_member_id`), so an embed must name the link: `family_nodes!family_nodes_member_id_fkey(...)`. A guard test enforces it. The same applies to any table with two links to one table.

---

## 7. DECISIONS (D = owner decisions, A = approvals)

| # | Decision |
|---|---|
| D1 | Payment intake is by statement upload (PDF/CSV). Automatic intake is wanted, **Daraja dropped**; see section 14 item 9 |
| D2 | A payment is applied **oldest debt first (FIFO)**; extra becomes advance credit; a leftover under target stays a partial month |
| D3 | Balance = (months due x target) minus everything counted for the member. Months due run from the joining month to the current Nairobi month |
| D4 | The joining month owes the full target (no proration) |
| D5 | A payment counts for the **payer** only; splitting is a manual admin action |
| D6 | Member login = **name + primary phone** (registered alternates also work), remembered 90 days, throttled |
| D7 | Ledger, totals, chat and tree are visible only after member login. (The "phones admin-only" part was replaced by D23 for the tree.) |
| D8 | Admin = one env login, separate from member login |
| D9 | "Total in account" must equal the M-PESA balance (see D22) |
| D10 | 7th reminder: members with balance > 0 are listed for a reminder (sent by hand via WhatsApp). Members with a payment **awaiting confirmation** are skipped and listed for the admin |
| D11 | 15th report: **everyone** with a phone is listed for one (sent by hand via WhatsApp): collected this month, total in account, their **own balance** (owing / up to date / paid ahead) and the site link. Other members are never named |
| D13 | **No text-message provider (11 Nov 2026).** Africa's Talking was removed (blocked route, a sender ID costs money). Reminders and reports are sent by the admin from the Reminders tab with WhatsApp links |
| D14 | One **primary** phone (login + reminders) plus any number of alternates (login + matching) |
| D15 | A phone match is counted automatically; a **name match is only a suggestion** ("Needs confirmation"); nothing usable goes to "Unmatched". **Never count money on a guess** |
| D16 | **Nothing hard-coded in the database**; all config comes from Setup |
| D17 | Members without a phone cannot log in or get a reminder (flagged for the admin) |
| D18 | Superadmin (env login) vs member-admin (`members.is_admin`); only the superadmin can grant the flag |
| D19 | Member lists and the ledger are **eldest first** by the linked tree node's date of birth; members with unknown ages follow in the **admin's manual order** (up/down arrows), then by name |
| D20 | A member with no tree entry must **connect to the tree** on first visit (claim an existing entry or add themselves under a parent). Never left floating |
| D21 | **"Group total this month"** = what members' contributions **cover** for the current month (advance payments included), not cash received. When everyone is paid up it is always members x target |
| D22 | **Every payment that really arrived counts in Total in account.** A payment's PURPOSE is separate from who it is credited to; only `monthly` pays off a member's months. "Ignored" means only "not credited to a member". A stray payment sent to the Till by mistake is **"Other income"** |
| D23 | **Family tree:** a member edits their own entry, their parent's and their children's; an admin edits everyone. Each person chooses which optional details the family sees (default visible; name and photo always shown); the people who can edit an entry always see its hidden details. Removal is a soft delete. The change log and undo were **removed** at the owner's request |
| D24 | **Chat, not a board page:** one floating chat; recipient = Everyone, one member (private, **not even the admin can read it**) or the Admin. The admin is texted when a member writes to them |
| D25 | **Mandatory when adding a person:** name, **date of birth**, parent. Everything else is optional. The date of birth may be **hidden from the family** but must be entered. Bio/work/education are **structured forms, not free text** (section 14) |
| D26 | **Family-only members (built v9.6):** `members.contributes` (default true). A member marked family-only can log in and use the **tree and chat**, but has **no ledger or balance** (`/api/dashboard` and `/api/ledger/full` return 403 for them, admins always pass, `/` and `/ledger` send them to `/tree`, the Dashboard link is hidden), is **left out of the group figures, reminders/reports and payment matching** (`.eq("contributes", true)`). An admin sets it on the Members tab ("Family only" badge, "Make family-only / Make contributing", and a tick when adding). **A member who already has payments counted for them cannot be made family-only** (it would silently change the group figures). Helper: `lib/access.ts` `memberContributes` (a missing value counts as contributing) |
| D27 | **Cancel out, without a trace (11 Nov 2026):** when money was taken out and put back, the **superadmin** can erase the withdrawal(s), the deposit(s) that put it back and the **M-PESA fee charged on those deposits** (the charge row with the same receipt) in one step. The Total in account must not change: **deposits - their fees = withdrawals**. Deposits are whole shillings and fees have cents, so a leftover of 0 or more but **under KES 1 per deposit** is kept as one plain payment (`purpose other`, `ignored`, note "Rounding"); a negative leftover or one of KES 1 or more is refused. Allowed: withdrawals/"other" expenses and manual/M-PESA deposits not credited to a member's monthly dues; never a fee on its own while its deposit is still recorded, opening balances or adjustments. A **hanging fee** (a charge row whose receipt is on `import_skip_receipts` and that no payment holds any more, found on the server) counts like money taken out, so a deposit paid in to cover it can be erased against it; any leftover (even over KES 1) stays as one plain "other income" payment with no note. **Nothing is logged**: no `job_runs` record, no label left on the ledger. Only the receipt numbers go to `import_skip_receipts` so an old statement cannot bring the entries back. The tool is shown only to the superadmin |
| A1 | Daraja dropped (23 Oct 2026) |
| A3 | Tree removals are soft deletes |

---

## 8. BUSINESS RULES THAT MUST NOT BREAK

1. **Money is never counted on a guess** (D15). Only allocations count toward a member.
2. **The ledger engine is pure** (`lib/ledger.ts`): no database inside. Colours: amber = due, green = paid, blue = prepaid, grey = before joining.
3. **Three different money figures:** (a) the member ledger = FIFO of `monthly` allocations; (b) **Group total this month** = ledger coverage of the current month (D21); (c) **Total in account** = all payments (any purpose, credited or not) minus all expenses (D22). The full ledger's final balance **equals (c)** and a test proves it. The Health tab compares (c) with the last statement's closing balance.
4. **Statement integrity check:** per transaction (a payment and its charge share a receipt), each transaction's final balance is the smallest of its reported balances, each is checked against the previous, the first is trusted as the start (statements are partial). Withdrawn amounts may be **negative** in the source. **The server refuses to commit if integrity fails.** The import reports rows it could not save instead of skipping silently; re-importing the same file is safe (receipts de-duplicate).
5. **Messages are never sent by the app.** The Reminders tab builds the text on the server and the admin opens WhatsApp with it. Phone numbers in the links are `254...` (no plus).
6. **Daily cron** (`/api/cron/daily`, `0 5 * * *` UTC = 08:00 Nairobi): a keep-alive query only (so Supabase's free tier never pauses), logged in `job_runs` for the Health tab. It sends nothing (v9.4).
7. **Nairobi time:** never read the month straight from a UTC timestamp; use `lib/dates.ts`.
8. **Supabase returns at most 1000 rows**: use `fetchAllRows` (`lib/pagination.ts`) for totals.
9. **Soft deletes only** for the tree and chat.
10. Reminders skip members awaiting confirmation; the report does not (it adds a note).
11. **Cancel out deletes rows** (not soft) and keeps no log. The receipt numbers of everything erased go to `import_skip_receipts`, so importing an old statement again skips them (they show as already recorded in the preview). A recovery deposit that points at an erased withdrawal must be erased with it (the route refuses otherwise). If a database step fails midway the route puts everything back.

---

## 9. SECURITY MODEL

* Every API route checks who is asking (`requireMember` / `requireAdmin` / `requireSuperAdmin` / `getActor` / cron secret). Public: `auth/*-login`, `auth/logout`, `health` (minimal `{ok}`; details for admins only). **A test scans every route file.**
* Backups/exports and the data-reset route are **superadmin only**; the reset also needs `ALLOW_TEST_DATA_RESET=true` and a typed phrase.
* Cookies: `httpOnly`, `secure` in production, `sameSite=lax`. Admin password compared in constant time. Login throttle 5 failures / 15 minutes.
* Headers on every response: `X-Frame-Options: DENY`, nosniff, Referrer-Policy, Permissions-Policy, HSTS, `X-Robots-Tag: noindex`, CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` (scripts deliberately unrestricted for Next).
* Privacy: tree details a person hides are removed **server-side** (`viewForViewer`); a private chat between two members is never returned to anyone else, **including the admin** (`visibleToMember`, the admin inbox only sees `to_admin` / `is_from_admin` rows); photos are validated (JPEG/PNG/WebP only, 100 KB; SVG refused).
* RLS on every table with no policies (`db/005`).

---

## 10. KEY FLOWS (short)

* **Statement import:** Import tab: choose file (+ password for PDF), Preview (shows balance check, every row's matched member), Import. PDF reading: `lib/pdf-statement.ts` (unpdf, y flipped to top-down, direction locked) -> `lib/pdf-table.ts` (header columns + receipt-anchored rows; tolerant of whole-phrase text pieces) -> `lib/statement-parser.ts` -> matching -> insert (`source: "statement"`).
* **Reminders:** `lib/messaging.ts` `planMessages` (a preview; sends and writes nothing) feeds `GET /api/admin/messages` and the Reminders tab (WhatsApp link + Copy text per member). The daily cron (`/api/cron/daily`) only runs a keep-alive query and logs it to `job_runs`.
* **Chat:** `components/ChatWidget.tsx` (home page and admin area) -> `/api/chat`; conversation keys `public`, `admin`, `member:<id>`, and for admins `inbox:<memberId>`.
* **Tree:** `components/FamilyTree.tsx` -> `/api/tree*`; edit rights from `loadEditContext` (`lib/tree-data.ts`).

---

## 11. VISUAL DESIGN ("the passbook")

Warm paper, ink, hairline rules, one accent. CSS variables in `app/globals.css` exposed to Tailwind (`ink`, `ink-soft`, `paper`, `surface`, `line`, `brass`, `forest`/`ochre`/`steel` with `-soft` tints, `danger`). Fraunces (serif) for headings and figures; system sans elsewhere; money uses `.figures`. Reuse the existing classes (`paper-card`, `btn-primary`, `btn-secondary`, `link`, `ledger-tabs`). The tree has its own classes (`.ftree`, `.fcard`, `.fphoto`, `.fgen-0..7` generation colours). Avoid generic AI-app styling.

---

## 12. LESSONS AND TRAPS (each one cost the owner real time)

1. **The sandbox type-checks with a newer target than the project.** Anything that passes there can still fail `npm run build` (the regex `s` flag did). The owner's build is the real check; `npx tsc --noEmit` is the quick version.
2. **Run new SQL before deploying code that reads the new columns.**
3. **Two foreign keys between the same tables break an unnamed PostgREST embed** (the Members list and dashboard went down). Name the link.
4. A constraint violation hidden by `continue` looked like success (payments silently not saved). **Always surface failed rows.**
5. **The owner's `package.json` is theirs** (installed deps). Do not ship it.
6. Windows CRLF line endings in the owner's files: when editing by script, preserve them.
7. A picture-only PDF has no text; only the original password-protected PDF can be read.
8. Direction detection by "nearest time below a date" must pick the NEAREST time (a bug shifted every wrapped line onto the next row).
9. After changing an env var on Vercel, **redeploy**.
10. **Never run `npm audit fix --force`** (it once downgraded `eslint-config-next` and broke every deploy).
11. Old test assertions can encode old (wrong) rules: when a rule changes, update the test to the new rule, and add a test that fails on the old code.
12. Do not trust the owner's zip to contain only what you expect: a `Readme  md` stray file and old `legacy/` existed.

---

## 13. TESTING AND VERIFICATION

* `npm test` (Node runner). Currently **315 pass, 0 fail** in the sandbox (303 in the last build the owner confirmed, v8.2). Add tests for every rule; add a regression test for every bug; prove a new guard test fails on the old code.
* Pure logic is exercised for real. Routes, components and SQL can only be syntax-checked in a sandbox: **say so plainly** and rely on the owner's `npm run build`, their screenshots and the Supabase check query.
* Before handing over a zip: apply it onto a clean copy of the owner's project (their `package.json` kept) and run `npm test`; syntax-check changed `.ts/.tsx`; type-check pure libs with target ES2017.
* Test fakes: a small fake Supabase client (chained `select/eq/order/limit/insert`) in `tests/reminders.test.ts`. **Rows must carry every column a query filters on** (adding `.eq("contributes", true)` to a query means the fake rows need `contributes: true`).

---

## 14. THE NEXT WORK (do these in order; one batch, files written once)

**Owner request (23 Oct 2026, from a screenshot of the join form):** the "add yourself" form is broken and incomplete, and these were asked for. Status: the planned work is finished (v9.1, v9.5, v9.6, v9.7). The owner **decided against** item 9 (automatic payment intake) on 11 Nov 2026, and item 10 (STK Push) is parked. The Pay helper (item 8) was built and then removed. Payments stay manual: the admin imports a statement.

0. **Bug (fixed in v9.1 in `lib/family-tree.ts`):** `sanitizeNodePatch` used to treat `undefined` keys as sent, so joining failed with "Spouse name must be text...". Still make sure `app/api/tree/connect/route.ts` and the forms only send defined fields.

1. **`db/009_family_profile.sql` (BUILT v9.5, file in `db/`; the owner must run it BEFORE the code goes online):** adds `family_nodes.education`, `work`, `residence`, `profile_completed_at` and `members.contributes` (default true, unused until item 5). `NODE_COLUMNS` already reads the new columns, so the site breaks until it has been run. Check query: four `true` values.

2. **Join form rewrite (BUILT v9.5 as the first-visit details form):** the first time a member opens the tree (no entry yet, or an entry whose `profile_completed_at` is null) they get `components/TreeOnboarding.tsx`. No entry: step 1 "Is one of these you?" (claim via `/api/tree/connect`, claim only) or "None of these is me: add me". Then the form, **pre-filled** when they have an entry: date of birth required (+ show tick), parent required with no preselected default (placeholder, "My parent is not listed: add them" with name + date of birth or approximate, "I am at the top of the tree" only for someone with an entry or an empty tree), phone, education, work, residence, spouse, about, photo; each with a "Show to the family" tick. A parent already in the tree is shown, not asked. Saved by `/api/tree/onboard` (rules in `lib/onboarding.ts`, name and links never taken from the browser), which sets `profile_completed_at`, so they are asked once. No skip button: date of birth and a parent are required. Every existing member is asked once, because every `profile_completed_at` starts null.

3. **"My information" section under the tree (BUILT v9.6, in `components/FamilyTree.tsx`):** always visible below the tree: photo, date of birth, education, work, where they live, spouse, and the buttons **Edit my details**, **Add my child**, **Add my spouse** (opens the same edit form, which has the spouse fields), **Add my parent** (only when there is no parent). It reuses the existing edit/add dialogs rather than a second inline form. The family's own education/employer/job-title entries now appear first in the suggestion lists (`collectSuggestions`).

4. **Structured profile editors (BUILT v9.5)** in `components/ProfileFields.tsx`, used by the first-visit form AND the edit/add-person form (the free-text work field is replaced; an old `work_education` note shows as "Older note", `bio` stays free text). Education/work up to 8 entries, residence with Kenya's counties; suggestions are the static lists (the family's own entries are not yet added to them). The card shows the three as readable lines. Original design notes:
   * **Education** (up to 8 entries): level (select: `EDUCATION_LEVELS`), institution (**`<input list>` datalist** suggestions from `INSTITUTIONS` + institutions already used by the family; free typing allowed), course (free, optional), start and end month (`<input type="month">`), "currently studying" checkbox.
   * **Work** (up to 8): status (select: `WORK_STATUSES`), employer (datalist from the family's entries), job title (datalist from `JOB_TITLES`), sector (select: `SECTORS`), start/end month, "current" checkbox.
   * **Residence**: country (datalist, **Kenya default**), then region (datalist of the 47 Kenyan counties when the country is Kenya, free text for other countries), then town/area (free text). Everything not in a list can be typed.
   * Each of phone, date of birth, education, work, residence, spouse has a "Show to the family" checkbox. **Extend `HIDEABLE_FIELDS`** with `education`, `work`, `residence` (keep the old `bio`/`workEducation`/`birthdate` names valid), add the three fields to `TreeNode`/`TreeRow`/`NodePatch`/`nodeFromRow`/`rowFromPatch`/`changedFields`, make `viewForViewer` blank lists to `[]` and `residence` to `null`, and call `sanitizeEducation/Work/Residence` from `sanitizeNodePatch` when those keys are present. The details panel shows entries with `describeEducation` / `describeWork` / `describeResidence`.
   * Mandatory only: name, date of birth, parent.

5. **Family-only members (D26): BUILT v9.6.** See D26 in section 13.

6. **Tests** (done for items 1, 2, 4 in v9.5: `tests/family-tree.test.ts` and `tests/session-token.test.ts`; still needed for 3 and 5) for every rule above (access guard strings in `tests/session-token.test.ts`, new-person rules, profile, contributes filtering in the fake-DB tests), a stacked-zip verification, README and GO-LIVE updates, and the owner's "Apply it" message (SQL 009 first).

7. Optional polish: siblings with only an approximate birth are now sorted by that year (BUILT v9.6). Still open: allow a second parent link if the owner wants both parents as entries.

8. **Pay helper: built in v9.6, then REMOVED in v9.7 at the owner's request** (it only showed an amount and the Till number and moved no money, so it added work without saving any). Do not rebuild it. The only way to make paying easier is a real phone prompt (item 10), which is parked.

9. **Automatic payment intake without Daraja: the owner DECIDED AGAINST this on 11 Nov 2026. Do not build it.** The research notes below are kept only so the reasons are not forgotten.
   * **Recommended: SMS forwarding.** The phone that receives the Till's "you have received KES X from NAME PHONE" text forwards each SMS (Android forwarder app, or a service such as Telerivet) to a secret URL, e.g. `POST /api/intake/sms/<INTAKE_SECRET>`; a pure parser (`lib/sms-intake.ts`) extracts receipt, amount, payer name, masked phone, time; insert + match + allocate like the statement import (`source: "statement"` or add a migration value; the receipt de-duplicates against later statement imports); unparseable messages go to a review queue, never guessed; add a Health card. Caveats: the phone must stay on and online and must really receive a per-payment SMS; Safaricom can change the wording. **The owner must first paste 3+ real payment SMS (names/numbers masked) and say which phone receives them.** Fresh intake should count in `loadDataFreshness`.
   * Aggregators (Kopo Kopo and others) give webhooks only for numbers issued through them (a **new Till**, plus fees); several are wrappers around Daraja. Not recommended unless the owner changes the Till.
   * Daraja, if ever revisited: C2B v2 register-URL is one-time in production; callback URLs must avoid words like mpesa/safaricom/exe/sql; v2 shows the payer phone masked as `2547 ***** 126` (strip spaces, then `canonicalMaskedPhone`); callbacks are unsigned (secret in the path); go-live needs Safaricom approval; which shortcode (Till 1611383 or store 1138423) is the registration number was an open question.

10. **Parked by the owner (11 Nov 2026): let a member prompt a payment from the site.** A real prompt on the phone is an M-PESA **STK Push** (a Daraja API, which the owner dropped, or an aggregator on its own Till). Do not start it without the owner; item 8 (the Pay helper) is the no-Daraja version and item 9 is automatic intake.

---

## 15. OWNER TODO LIST (confirm with the owner)

* Run `db/005`, `db/006`, `db/007` in Supabase (check query values `true`); `db/008` (erase cancelled, v9.2); later `db/009`.
* **Rotate secrets** and check git history for `.env.local` (`docs/GO-LIVE.md`, Part 1).
* In Vercel, delete `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID` and `SMS_LIVE`, then redeploy. Set the **Site address** in Setup to `https://family-fund-app-nine.vercel.app`.
* Import the latest statement before the 7th each month; clear the Needs-confirmation / Unmatched queues; download a full backup monthly (Health tab).
* Send the sample payment SMS (section 14 item 9) and answer the parent question (3.4).
* Run `npm uninstall africastalking` once (it updates `package.json` and `package-lock.json`).
* Confirm everything that is unconfirmed in 3.3.

---

## 16. CHANGELOG (compact, newest first)

* **v9.7 (11 Nov 2026):** the **Pay helper was removed** (`components/PayHelper.tsx`, `lib/pay.ts`, its tests and the dashboard box): it moved no money, so it only added work. The automatic payment intake (item 9) was declined by the owner. Nothing else changed. 315 tests.
* **v9.6 (11 Nov 2026):** **family-only members** (`members.contributes`, uses `db/009`): no ledger/balance/reminders/group figures, tree and chat stay open, admin toggle on the Members tab, refused for a member with payments; (a Pay helper was also added, then removed in v9.7); **My information** section under the tree; the family's own entries as suggestions; approximate-birth ordering. 318 tests.
* **v9.5 (11 Nov 2026):** **first-visit details form for the family tree**: a member is asked once (no entry yet, or an uncompleted entry, which comes pre-filled) for date of birth, parent and optional phone/education/work/residence/spouse/about, each with a "Show to the family" tick; structured education/work/residence editors; `db/009`; `/api/tree/onboard`; `/api/tree/connect` now only claims an entry; `needsProfile` in `/api/tree`; the card shows the new details. 310 tests.
* **v9.4 (11 Nov 2026):** **Africa's Talking and all app-sent texts removed** (see 3.4 for the list). The Reminders tab is now a WhatsApp/Copy list; the daily cron is keep-alive only; the Health tab loses the SMS and import-alert lines; Setup loses the alert phone and the "hold automatic texts" wording (the stale-data limit stays as a warning). `db` unchanged. 301 tests.
* **v9.3 (11 Nov 2026):** Cancel out accepts a **hanging fee** (its deposit already erased) against a deposit paid in to cover it; leftover over KES 1 is allowed only in that case and is kept as plain other income. `lib/cancel-out.ts` (`orphanFee`, `leftoverIsRounding`), cancel-out route (`hangingFees`, server-decided), panel lists hanging fees. 322 tests.
* **v9.2 (11 Nov 2026):** **cancel out without a trace**: also erases the M-PESA fee charged on the deposit; deposit - fee must equal the withdrawal, cents of rounding kept as one "Rounding" line; no `job_runs` audit; erased receipt numbers kept in `import_skip_receipts` so old statements cannot resurrect them (statement import skips them); tool shown only to the superadmin (`AdminShell`/`PaymentsManager` get `isSuperAdmin`); `db/008` (also copies receipts from old cancel_out records and deletes those records); family-profile migration renumbered to `db/009`. 320 tests.
* **v9.1 (23 Oct 2026):** **cancel out** a withdrawal and the deposit(s) that put it back (`lib/cancel-out.ts`, `/api/admin/cancel-out`, `components/admin/CancelOutPanel.tsx`, Payments tab; superadmin only; equal totals only; audit in `job_runs`); join-form bug fixed (`has()` ignores undefined); pure profile libraries and option lists added (not wired); this handover README. 314 tests.
* **v8.2:** tree fit-to-screen + zoom controls + scrollbars; colour per generation (8 colours). **v8.1.1:** regex `s` flag build fix (ES2017) + guard test. **v8.1:** tree redesign (real tree with photo cards, edit rights, per-field privacy, photos), chat replaces the board page, change log removed, Daraja dropped, `db/007`. **v8.0:** tree + board + shared navigation.
* **v7.x:** payment purposes and other-income notes (`db/006`), Total in account counts every payment, Health check against the statement balance; hardening (`db/005`, locked reset, security tests, GO-LIVE guide).
* **v6.x:** members CSV merge + masked numbers, PDF reader on unpdf and rebuilt for the real layout, payments-not-saving fix (`source: "statement"`), reminders and report with preview, admin alerts, Health tab, backups/exports, full ledger, group total = ledger coverage.
* **v1-v5:** foundation, ledger engine, login, setup, members, payments matching, member dashboard, passbook design, statement import, SMS + reminders, daily cron.
