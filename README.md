# Family Emergency Fund Platform: Handover README (v9.2, 11 Nov 2026)

> **This file is the single source of truth for continuing the project with any AI agent or developer.** It describes the app, the owner, the rules, the exact state of the work, and what to do next. **The code is the truth for what is implemented; this file is the truth for intent, decisions and rules.** Verify this README against the real code before changing anything.

---

## 0. START HERE (how to resume in a new chat)

1. Ask the owner to attach: **(a)** this README, **(b)** a fresh **zip of the project folder** (no `node_modules`, no `.next`, **never `.env.local`**), **(c)** a current **Supabase schema export** (the "CREATE TABLE" listing, as `.sql`), and **(d)** any screenshots or error text.
2. Ask which **delivery zips and SQL files the owner has actually applied** (section 3.3 lists what exists and what is unconfirmed). Trust the zip they upload over any assumption.
3. Say: *"Continue this project. Read the README first, then check it against the actual code and tell me what is left."* Then follow **section 14 (the next work)**.
4. **Never ask the owner to paste a real secret** (Supabase service key, admin password, Africa's Talking key, session secrets). They live only in Vercel Environment Variables and the local `.env.local`.
5. The sandbox you work in probably **cannot** run `next build`, run SQL, or open a real PDF. The owner's `npm run build` and the Supabase SQL editor are the real tests (section 13).

---

## 1. WHAT THIS APP IS

A private web app for a **family emergency fund** that started **August 2026**:

* Working family members each owe **KES 300 a month** (`target_amount`, editable in Setup) paid to **M-PESA Till 1611383** (the statement shows store/shortcode 1138423; customers pay the Till).
* **Financial year** = 1 August to 31 July. About **16 contributing members**.
* One shared site. Members log in and see their own balance, the month-by-month ledger of everyone's contributions, the family tree and a chat. One admin runs it.
* The app should **run itself**: stay awake (Supabase free tier pauses after ~7 idle days), text arrears reminders on the 7th and a fund report on the 15th, warn the admin when payment data is stale, and keep the books reconciled with the M-PESA balance.
* Payments reach the app by **uploading the M-PESA statement** (PDF with password, or CSV). Automatic intake is wanted but **Daraja was dropped by the owner** (section 14, item 9).

Live at `https://family-fund-app-nine.vercel.app` (Vercel). GitHub: `github.com/danmusyokabness/family-fund-app` (private). Africa's Talking app username: `familyfundapp`.

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
| Texts: 7th reminder, 15th report, preview/confirm/send-now screen, automatic daily job, hold when data is stale, **admin alert to import the statement**, WhatsApp links | ✅ (live sending needs the owner's Africa's Talking key and `SMS_LIVE=true`; owner status unconfirmed) |
| Health tab (daily job, data age, texting mode, waiting payments, members without a phone, backup age, "Total in account matches M-PESA", unread chat messages), backup + CSV exports (superadmin only) | ✅ |
| Hardening: every route checks who is asking, locked data-reset, minimal public health page, security headers, `db/005` RLS lock, `docs/GO-LIVE.md` | ✅ |
| **Family tree** drawn as a real tree: photo cards, parent-child lines, **fit to screen + zoom bar/buttons + scrollbars, colour per generation**, details panel, add/edit with privacy toggles, photo upload, "Where are you in the family?" first-visit step | ✅ delivered in v8.1/v8.2 |
| **Cancel out** (Payments tab): erase a withdrawal, the deposit(s) that put it back and the M-PESA fee on those deposits, in one step, with the Total in account unchanged and no trace left (a few cents of rounding stay as one plain "Rounding" line). The tool is shown to and usable by the superadmin only | ✅ v9.2 (needs `db/008`) |
| **Chat** (floating button: Everyone / a member privately / the Admin; admin inbox in the same widget; text to admin on a private message) | ✅ |

### 3.2 Pure libraries added in v9.1 but NOT wired into the app yet

Delivered in `cancel-out-17.zip` together with the cancel-out feature (they change nothing the owner sees):

* **Bug fix in `lib/family-tree.ts`:** `sanitizeNodePatch` now treats a key whose value is `undefined` as "not sent". That was the cause of "Spouse name must be text. Work / education must be text. Bio must be text." on the join form (the connect route builds an object with undefined values). A regression test covers it.
* `lib/profile.ts` (new): structured education / work / residence entries, validators (`sanitizeEducation`, `sanitizeWork`, `sanitizeResidence`) and readable-line helpers (`describeEducation`, `describeWork`, `describeResidence`).
* `lib/data/places.ts` (new): countries (Kenya first), Kenya's 47 counties, `regionsFor`. `lib/data/careers.ts` (new): education levels, work statuses, sectors, Kenyan institutions, job titles.
* Tests for these are appended to `tests/family-tree.test.ts`.

**Still to build** (section 14): `TreeNode`/`TreeRow`/patches do not yet carry `education`, `work`, `residence`; `HIDEABLE_FIELDS` must gain `education`, `work`, `residence`; `hasBirth` and `newPersonProblem` (the mandatory name + birth date rules) do not exist yet; migration `db/009`; the API and UI; family-only members; the pay helper.

### 3.3 What the owner has applied (UNCONFIRMED: ask)

Delivered zips in order (each later one is cumulative over the earlier ones unless noted): `batch-1` (db 001-004, SMS fix, PDF reader, member ordering), `all-fixes-combined`, `reminders-6`, `ledger-and-messages-7`, `admin-complete-8`, `alerts-9`, `hardening-10`, `payment-purposes-11`, `other-income-12`, `tree-and-board-13`, `tree-chat-14`, `fix-photo-regex-15`, `tree-zoom-colour-16`, `fix-join-form-17`, `erase-cancelled-18`. From a screenshot the owner has deployed **at least `tree-chat-14`**. SQL files `db/005`, `db/006`, `db/007` were requested, and **`db/008` (erase cancelled) is new in v9.2**; **confirm they ran** (compare the schema export with section 6). Also unconfirmed: secrets rotated (the very first zip contained `.env.local`), `git rm -r legacy` (confirmed done), Africa's Talking key and credit, `SMS_LIVE`.

### 3.4 Owner decisions pending / open questions

* **Parents:** the tree has ONE parent link per person (`parent_id`); the other parent is shown on the card as the "spouse" text. The owner said "parents" are mandatory. Ask whether one parent link is enough or both parents must be separate entries (that would need a second link).
* **Payment text samples** for the free automatic intake (section 14, item 9). Still waiting.
* **Old fee rows (11 Nov 2026):** before v9.2, cancel-out refused M-PESA charges, so the fee on a put-back deposit stayed on the books and members see it as an unexplained charge. `db/008`'s check query shows how many such rows exist (`fee_rows_left_from_old_cancels`). Erasing one would change the Total in account by its amount, so it needs the owner's decision (keep it as a real cost, or have it covered by a deposit and cancel the group out).
* **Reminder texts failing (11 Nov 2026):** every send in the Reminders tab failed with "Request failed with status code 401" (Africa's Talking rejecting the login). Check `AT_API_KEY` (regenerate it), `AT_USERNAME` (`familyfundapp`, not `sandbox`), then redeploy; test with the owner's own number first. Failed sends can be sent again.
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
| SMS | **Africa's Talking** (`africastalking` npm package; type stub `lib/africastalking.d.ts`) |
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
| `AT_API_KEY`, `AT_USERNAME` (`familyfundapp`), `AT_SENDER_ID` (leave empty) | key: yes | Africa's Talking |
| `SMS_LIVE` | no | `false` = every send is a logged dry run; `true` = real SMS |
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
  cancel-out.ts      rules for cancelling out a withdrawal + the deposit(s) that put it back + the fee on those deposits (deposit - fee = withdrawal, a few cents of rounding allowed)
  ledger-data.ts(SERVER) loads full-ledger inputs
  settings.ts        setting schema, defaults, validation
  message-templates.ts reminders.ts report.ts admin-alerts.ts sms.ts messaging.ts(SERVER: plan + send texts)
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
         fund-expenses,statements/import,messages,sms-log,health,export,reset-test-data,cancel-out}

components/: AppNav ChatWidget FamilyTree FullLedger LogoutButton MemberDashboard OtherIncomeNotes
components/admin/: AdminShell(tabs: Members Payments Import Reminders Health Setup + floating chat)
                   MembersManager PaymentsManager CancelOutPanel StatementImport Reminders HealthPanel SetupForm
tests/ (19 files; the package.json "test" script lists each):
  dates phone ledger session-token(security guards) csv members-import settings payment-matching dashboard
  statement-parser pdf-statement-line statement-csv reminders(messaging+health+alerts) sms pdf-table
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
| `sms_log` | `kind` (`reminder`/`report`/`test`), `period` (`YYYY-MM`), `status` (`dry_run`/`sent`/`failed`/`skipped`); **a unique index allows only one `sent` per kind+period+member** |
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
| D10 | 7th reminder: members with balance > 0 get one SMS. Members with a payment **awaiting confirmation** are skipped and listed for the admin |
| D11 | 15th report: **everyone** with a phone gets one SMS: collected this month, total in account, their **own balance** (owing / up to date / paid ahead) and the site link. Other members are never named |
| D13 | SMS via Africa's Talking, **no custom sender ID** |
| D14 | One **primary** phone (login + SMS) plus any number of alternates (login + matching) |
| D15 | A phone match is counted automatically; a **name match is only a suggestion** ("Needs confirmation"); nothing usable goes to "Unmatched". **Never count money on a guess** |
| D16 | **Nothing hard-coded in the database**; all config comes from Setup |
| D17 | Members without a phone cannot log in or get SMS (flagged for the admin) |
| D18 | Superadmin (env login) vs member-admin (`members.is_admin`); only the superadmin can grant the flag |
| D19 | Member lists and the ledger are **eldest first** by the linked tree node's date of birth; members with unknown ages follow in the **admin's manual order** (up/down arrows), then by name |
| D20 | A member with no tree entry must **connect to the tree** on first visit (claim an existing entry or add themselves under a parent). Never left floating |
| D21 | **"Group total this month"** = what members' contributions **cover** for the current month (advance payments included), not cash received. When everyone is paid up it is always members x target |
| D22 | **Every payment that really arrived counts in Total in account.** A payment's PURPOSE is separate from who it is credited to; only `monthly` pays off a member's months. "Ignored" means only "not credited to a member". A stray payment sent to the Till by mistake is **"Other income"** |
| D23 | **Family tree:** a member edits their own entry, their parent's and their children's; an admin edits everyone. Each person chooses which optional details the family sees (default visible; name and photo always shown); the people who can edit an entry always see its hidden details. Removal is a soft delete. The change log and undo were **removed** at the owner's request |
| D24 | **Chat, not a board page:** one floating chat; recipient = Everyone, one member (private, **not even the admin can read it**) or the Admin. The admin is texted when a member writes to them |
| D25 | **Mandatory when adding a person:** name, **date of birth**, parent. Everything else is optional. The date of birth may be **hidden from the family** but must be entered. Bio/work/education are **structured forms, not free text** (section 14) |
| D26 | **Family-only members:** people who are not contributors (students, not yet working) can still log in and see the tree and chat but **not the ledger**; the admin later toggles them to contribute (section 14) |
| D27 | **Cancel out, without a trace (11 Nov 2026):** when money was taken out and put back, the **superadmin** can erase the withdrawal(s), the deposit(s) that put it back and the **M-PESA fee charged on those deposits** (the charge row with the same receipt) in one step. The Total in account must not change: **deposits - their fees = withdrawals**. Deposits are whole shillings and fees have cents, so a leftover of 0 or more but **under KES 1 per deposit** is kept as one plain payment (`purpose other`, `ignored`, note "Rounding"); a negative leftover or one of KES 1 or more is refused. Allowed: withdrawals/"other" expenses and manual/M-PESA deposits not credited to a member's monthly dues; never a fee on its own, opening balances or adjustments. **Nothing is logged**: no `job_runs` record, no label left on the ledger. Only the receipt numbers go to `import_skip_receipts` so an old statement cannot bring the entries back. The tool is shown only to the superadmin |
| A1 | Daraja dropped (23 Oct 2026) |
| A3 | Tree removals are soft deletes |

---

## 8. BUSINESS RULES THAT MUST NOT BREAK

1. **Money is never counted on a guess** (D15). Only allocations count toward a member.
2. **The ledger engine is pure** (`lib/ledger.ts`): no database inside. Colours: amber = due, green = paid, blue = prepaid, grey = before joining.
3. **Three different money figures:** (a) the member ledger = FIFO of `monthly` allocations; (b) **Group total this month** = ledger coverage of the current month (D21); (c) **Total in account** = all payments (any purpose, credited or not) minus all expenses (D22). The full ledger's final balance **equals (c)** and a test proves it. The Health tab compares (c) with the last statement's closing balance.
4. **Statement integrity check:** per transaction (a payment and its charge share a receipt), each transaction's final balance is the smallest of its reported balances, each is checked against the previous, the first is trusted as the start (statements are partial). Withdrawn amounts may be **negative** in the source. **The server refuses to commit if integrity fails.** The import reports rows it could not save instead of skipping silently; re-importing the same file is safe (receipts de-duplicate).
5. **SMS safety:** `SMS_LIVE` defaults to false (dry runs). One real SMS per member per kind per period (DB index + plan check). The sender number is sent as `+254...`.
6. **Daily cron** (`/api/cron/daily`, `0 5 * * *` UTC = 08:00 Nairobi): keep-alive query; reminder if today is within `reminder_day..+2`; report within `report_day..+2`; then the **admin alert**. Each job is independent. **Automatic sends are held when the last statement import is older than `auto_send_max_import_age_days`** (default 4; 0 = never hold) so people who already paid are not chased; a manual send is never held. The admin is texted two days before each send day and on each held day.
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
* **Texts:** `lib/messaging.ts` `planMessages` (preview, sends nothing) and `sendMessages` (re-plans on the server, never trusts browser text, logs to `sms_log`). Used by the cron and by `POST /api/admin/messages`.
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

* `npm test` (Node runner). Currently **320 pass, 0 fail** in the sandbox (303 in the last build the owner confirmed, v8.2). Add tests for every rule; add a regression test for every bug; prove a new guard test fails on the old code.
* Pure logic is exercised for real. Routes, components and SQL can only be syntax-checked in a sandbox: **say so plainly** and rely on the owner's `npm run build`, their screenshots and the Supabase check query.
* Before handing over a zip: apply it onto a clean copy of the owner's project (their `package.json` kept) and run `npm test`; syntax-check changed `.ts/.tsx`; type-check pure libs with target ES2017.
* Test fakes: a small fake Supabase client (chained `select/eq/order/limit/insert`) in `tests/reminders.test.ts`. **Rows must carry every column a query filters on** (adding `.eq("contributes", true)` to a query means the fake rows need `contributes: true`).

---

## 14. THE NEXT WORK (do these in order; one batch, files written once)

**Owner request (23 Oct 2026, from a screenshot of the join form):** the "add yourself" form is broken and incomplete, and these were asked for. Status: item 0 is fixed (v9.1); the rest is designed, not built.

0. **Bug (fixed in v9.1 in `lib/family-tree.ts`):** `sanitizeNodePatch` used to treat `undefined` keys as sent, so joining failed with "Spouse name must be text...". Still make sure `app/api/tree/connect/route.ts` and the forms only send defined fields.

1. **`db/009_family_profile.sql` (idempotent, with a check query; was 008 before v9.2):** `alter table members add column if not exists contributes boolean not null default true;` and on `family_nodes`: `education jsonb not null default '[]'::jsonb`, `work jsonb not null default '[]'::jsonb`, `residence jsonb`. Then add `education, work, residence` to `NODE_COLUMNS` in `lib/tree-data.ts` **only after the owner has run 009**.

2. **Join form rewrite** (`ConnectToTree` in `components/FamilyTree.tsx` + `app/api/tree/connect/route.ts`): name read-only from the member record; **date of birth required** with a "Show to the family" toggle (hidden fields are still stored); **parent required** with **no preselected default** (a placeholder "Choose..."; the old form defaulted to a wrong person); an option **"My parent is not listed: add them"** (parent name + date of birth or an approximate date); claim-an-existing-entry flow still offered (require a DOB if that entry has none); "start the tree" when empty. Enforce on the server with a new pure `newPersonProblem(patch, { own })` in `lib/family-tree.ts` (to be written: needs a name; `own: true` needs the exact `dateOfBirth`; someone else's entry may use an approximate `birthdate` text instead) and `hasBirth(p)`; `PATCH` must never clear an existing birth date. Optional photo.

3. **"My information" section under the tree** (visible without clicking your card): an always-editable form for the member's own entry (photo, date of birth + show toggle, phone, education, work, residence, spouse) with Save, and **buttons "Add my child", "Add my spouse", "Add my parent"** (the last only if there is no parent) above/beside it. Spouse stays quiet and optional (name + short details, stored in `spouse_name` / `spouse_details`).

4. **Structured profile editors** in a new `components/ProfileFields.tsx`, used by the own-info form AND the edit/add-person form (replace the free-text work/bio fields; show any legacy `work_education`/`bio` text as an "older note"):
   * **Education** (up to 8 entries): level (select: `EDUCATION_LEVELS`), institution (**`<input list>` datalist** suggestions from `INSTITUTIONS` + institutions already used by the family; free typing allowed), course (free, optional), start and end month (`<input type="month">`), "currently studying" checkbox.
   * **Work** (up to 8): status (select: `WORK_STATUSES`), employer (datalist from the family's entries), job title (datalist from `JOB_TITLES`), sector (select: `SECTORS`), start/end month, "current" checkbox.
   * **Residence**: country (datalist, **Kenya default**), then region (datalist of the 47 Kenyan counties when the country is Kenya, free text for other countries), then town/area (free text). Everything not in a list can be typed.
   * Each of phone, date of birth, education, work, residence, spouse has a "Show to the family" checkbox. **Extend `HIDEABLE_FIELDS`** with `education`, `work`, `residence` (keep the old `bio`/`workEducation`/`birthdate` names valid), add the three fields to `TreeNode`/`TreeRow`/`NodePatch`/`nodeFromRow`/`rowFromPatch`/`changedFields`, make `viewForViewer` blank lists to `[]` and `residence` to `null`, and call `sanitizeEducation/Work/Residence` from `sanitizeNodePatch` when those keys are present. The details panel shows entries with `describeEducation` / `describeWork` / `describeResidence`.
   * Mandatory only: name, date of birth, parent.

5. **Family-only (non-contributing) members (D26):** `members.contributes`. They can log in (name + phone) and use the tree and chat but not the ledger. Server: add `lib/access.ts` `memberContributes(db, memberId)`; in `app/api/dashboard/route.ts` and `app/api/ledger/full/route.ts` refuse (403) a member who does not contribute (admins exempt via `getAdminContext`) and filter the members query with `.eq("contributes", true)`; `app/page.tsx` and `app/ledger/page.tsx` redirect them to `/tree`; `AppNav` hides "Dashboard" for them; `lib/messaging.ts` members query adds `.eq("contributes", true)` (reminders and reports ignore them; **update the fake-DB rows in `tests/reminders.test.ts` with `contributes: true`**). Admin: Members tab gets a "Contributes monthly" checkbox on add and edit, a "Family only" badge, and when switching someone ON the admin sets the **start month** (`joined_on`, first of a month); `POST/PATCH /api/admin/members` accept `contributes`. The admin adds family-only members (name + phone) so they can log in. Document in `docs/GO-LIVE.md`.

6. **Tests** for every rule above (access guard strings in `tests/session-token.test.ts`, new-person rules, profile, contributes filtering in the fake-DB tests), a stacked-zip verification, README and GO-LIVE updates, and the owner's "Apply it" message (SQL 009 first).

7. Optional polish: sort siblings by an approximate year when only an approximate birth is known; allow a second parent link if the owner wants both parents as entries.

8. **Click-to-pay (answered honestly to the owner):** a real "prompt on the phone with a pre-filled amount" is the M-PESA **STK Push**, which is a **Daraja** API (the owner dropped Daraja; aggregators do the same through their own Till). Instead build a **"Pay" helper** on the member dashboard: choose the **number of months** (default = months owed, plus advance months); amount = months x `target_amount` (or exact balance when owing); show the **Till number**, the amount and which months it covers; **copy** buttons; step-by-step instructions; a `tel:*334%23` link to open the M-PESA menu (the statement itself says "dial *334#"). Put the maths in a pure `lib/pay.ts` with tests. The data is already in `/api/dashboard` (`targetAmount`, `tillNumber`, `me.balance`, `me.credit`). When automatic intake exists, a payment made this way appears by itself.

9. **Automatic payment intake without Daraja (research 22-23 Oct 2026; not built):**
   * **Recommended: SMS forwarding.** The phone that receives the Till's "you have received KES X from NAME PHONE" text forwards each SMS (Android forwarder app, or a service such as Telerivet) to a secret URL, e.g. `POST /api/intake/sms/<INTAKE_SECRET>`; a pure parser (`lib/sms-intake.ts`) extracts receipt, amount, payer name, masked phone, time; insert + match + allocate like the statement import (`source: "statement"` or add a migration value; the receipt de-duplicates against later statement imports); unparseable messages go to a review queue, never guessed; add a Health card. Caveats: the phone must stay on and online and must really receive a per-payment SMS; Safaricom can change the wording. **The owner must first paste 3+ real payment SMS (names/numbers masked) and say which phone receives them.** Fresh intake should count in `loadDataFreshness`.
   * Aggregators (Kopo Kopo and others) give webhooks only for numbers issued through them (a **new Till**, plus fees); several are wrappers around Daraja. Not recommended unless the owner changes the Till.
   * Daraja, if ever revisited: C2B v2 register-URL is one-time in production; callback URLs must avoid words like mpesa/safaricom/exe/sql; v2 shows the payer phone masked as `2547 ***** 126` (strip spaces, then `canonicalMaskedPhone`); callbacks are unsigned (secret in the path); go-live needs Safaricom approval; which shortcode (Till 1611383 or store 1138423) is the registration number was an open question.

10. **Parked by the owner (11 Nov 2026): let a member prompt a payment from the site.** A real prompt on the phone is an M-PESA **STK Push** (a Daraja API, which the owner dropped, or an aggregator on its own Till). Do not start it without the owner; item 8 (the Pay helper) is the no-Daraja version and item 9 is automatic intake.

---

## 15. OWNER TODO LIST (confirm with the owner)

* Run `db/005`, `db/006`, `db/007` in Supabase (check query values `true`); `db/008` (erase cancelled, v9.2); later `db/009`.
* **Rotate secrets** and check git history for `.env.local` (`docs/GO-LIVE.md`, Part 1).
* Africa's Talking: generate the API key, add credit, set `AT_API_KEY`, `AT_USERNAME`, then `SMS_LIVE=true` and redeploy; test to themselves first. Set their phone in Setup ("Your phone number, for reminders to import the statement") and the **Site address** `https://family-fund-app-nine.vercel.app`.
* Import the latest statement before the 7th each month; clear the Needs-confirmation / Unmatched queues; download a full backup monthly (Health tab).
* Send the sample payment SMS (section 14 item 9) and answer the parent question (3.4).
* Fix the Africa's Talking 401 (see 3.4) and resend the failed reminders.
* Confirm everything that is unconfirmed in 3.3.

---

## 16. CHANGELOG (compact, newest first)

* **v9.2 (11 Nov 2026):** **cancel out without a trace**: also erases the M-PESA fee charged on the deposit; deposit - fee must equal the withdrawal, cents of rounding kept as one "Rounding" line; no `job_runs` audit; erased receipt numbers kept in `import_skip_receipts` so old statements cannot resurrect them (statement import skips them); tool shown only to the superadmin (`AdminShell`/`PaymentsManager` get `isSuperAdmin`); `db/008` (also copies receipts from old cancel_out records and deletes those records); family-profile migration renumbered to `db/009`. 320 tests.
* **v9.1 (23 Oct 2026):** **cancel out** a withdrawal and the deposit(s) that put it back (`lib/cancel-out.ts`, `/api/admin/cancel-out`, `components/admin/CancelOutPanel.tsx`, Payments tab; superadmin only; equal totals only; audit in `job_runs`); join-form bug fixed (`has()` ignores undefined); pure profile libraries and option lists added (not wired); this handover README. 314 tests.
* **v8.2:** tree fit-to-screen + zoom controls + scrollbars; colour per generation (8 colours). **v8.1.1:** regex `s` flag build fix (ES2017) + guard test. **v8.1:** tree redesign (real tree with photo cards, edit rights, per-field privacy, photos), chat replaces the board page, change log removed, Daraja dropped, `db/007`. **v8.0:** tree + board + shared navigation.
* **v7.x:** payment purposes and other-income notes (`db/006`), Total in account counts every payment, Health check against the statement balance; hardening (`db/005`, locked reset, security tests, GO-LIVE guide).
* **v6.x:** members CSV merge + masked numbers, PDF reader on unpdf and rebuilt for the real layout, payments-not-saving fix (`source: "statement"`), reminders and report with preview, admin alerts, Health tab, backups/exports, full ledger, group total = ledger coverage.
* **v1-v5:** foundation, ledger engine, login, setup, members, payments matching, member dashboard, passbook design, statement import, SMS + reminders, daily cron.
