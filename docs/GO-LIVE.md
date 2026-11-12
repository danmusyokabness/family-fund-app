# Family Emergency Fund: Go-live guide and monthly routine

Written for someone with no technical background. Follow it top to bottom, one step at a time. Anything in a grey box is typed or pasted exactly as shown. If a screen does not look like the description, take a screenshot and ask: do not guess.

**Never paste a password, key or secret into a chat, an email or a file in GitHub.** They go in exactly one place: Vercel's Environment Variables page.

---

## PART 1. Before going live (do once)

### Step 1. Remove the old unused code

The folder `legacy` contains old code from an earlier attempt, including a made-up fallback password. The website does not use it, but it should not be in your repository.

Open Command Prompt in your project folder and run each line, one at a time:

```bat
git rm -r legacy
git commit -m "Remove old unused legacy code"
git push
```

### Step 2. Check that no secret was ever uploaded to GitHub

The very first project zip contained a file named `.env.local`. This check shows whether it was ever saved into your repository's history:

```bat
git log --all --full-history -- .env.local
```

* **Nothing is printed:** it was never uploaded. Good.
* **Lines like `commit 3f2a...` are printed:** an old copy of your secrets is in your GitHub history. Your repository is private, which limits the risk, but you **must** do Step 3 in full and treat every old key as exposed.

### Step 3. Change every secret (do this even if Step 2 printed nothing)

You will create four new secrets and put them into Vercel. Do them all, then redeploy once at the end.

**3a. Make three new random secrets.** Run this command **three times**. Each time it prints a different long random text. Copy each one into a Notepad file and label them `ADMIN_PASSWORD`, `SESSION_SECRET` and `CRON_SECRET`:

```bat
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The one labelled `ADMIN_PASSWORD` is the password you will type to log in as admin, so save it in a password manager (or in Chrome's "Save password" prompt) as well. Keep the Notepad file off GitHub and delete it when you have finished.

**3b. Get a new Supabase service key.**

1. Open your project at supabase.com.
2. Click **Project Settings** (the cog), then **API Keys**.
3. Find the **service_role** key (some versions call it the "secret" key). Look for a button to **rotate**, **reset** or **create a new** key.
4. Create the new key and copy it into your Notepad file, labelled `SUPABASE_SERVICE_ROLE_KEY`.
5. Do **not** delete the old key until Step 3d is finished and the site works.

If your Supabase screen does not match this description, send me a screenshot of the API Keys page.

**3c. Put the new values into Vercel.**

1. Go to vercel.com, open your project, click **Settings**, then **Environment Variables**.
2. For each name in the table below, click the **three dots** on its row, click **Edit**, paste the new value, and **Save**. (If a name is missing, click **Add** and create it.)

| Name | What to put |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | the new Supabase key from 3b |
| `ADMIN_PASSWORD` | the new admin password from 3a |
| `SESSION_SECRET` | the new random text from 3a |
| `CRON_SECRET` | the new random text from 3a |
| `ADMIN_USERNAME` | the admin username you want (your choice, no secret needed) |
| `NEXT_PUBLIC_SUPABASE_URL` | unchanged: your Supabase project URL |

**3d. Redeploy, then test.** A changed setting does nothing until the site is rebuilt.

1. In Vercel click **Deployments**, then the **three dots** on the newest one, then **Redeploy**, and confirm.
2. Wait until it says **Ready**.
3. Open your site's `/admin/login` and log in with the new username and password. (Everyone is logged out once, which is expected.)
4. Only after this works, go back to Supabase and delete the **old** service key.

### Step 4. Lock the database and check it

1. In Supabase click **SQL Editor**, then **New query**.
2. Open the file `db/005_security_check.sql` from your project in Notepad, select all, copy, paste into Supabase, and click **Run**.
3. A table of your tables appears. In **every row** you must see `row_level_security_on` = true, `anon_can_read` = false, and `signed_in_role_can_read` = false. If any row differs, take a screenshot and ask.

This file is safe to run again at any time.

Also run `db/006_payment_purpose.sql` the same way (SQL Editor, New query, paste, Run). It adds the "what is this payment for" information. Every value in the small table at the bottom must say `true`. It is safe to run twice. Run it **before** you deploy a new version of the code that mentions payment types.

### Step 5. Switch off the "wipe test data" button

The Members tab has a red "Clear test data" area for the testing period. It is now locked and does nothing unless a Vercel setting called `ALLOW_TEST_DATA_RESET` is `true`. It is off by default, which is what you want. Check that this setting is **not** present in Vercel, or is set to `false`.

---

## PART 2. Set the fund up

### Step 6. Setup tab

Open `/admin` and click **Setup**. Check or fill in every field, then **Save**:

* **Fund name**, **Till number** (the number members really pay to), **monthly target** (300), **financial-year start month** (August = 8).
* **Reminder day** (7) and **Report day** (15).
* **Site address**: `https://family-fund-app-nine.vercel.app` (it goes in every reminder message as the link).
* **Flag the payment data as old after this many days**: leave at 4. The Reminders and Health tabs then warn you to import a newer statement before you send reminders.
* **Message wording** for the reminder and the report. Read both. They must include the balance and the site link.

### Step 7. Members tab

* Check all 16 members are listed with the right primary phone.
* For anyone who sometimes pays from another number, open them and fill in: **other phone numbers**, **till or business numbers they pay from**, and **numbers as shown on statements** (like `254110***358`). Several numbers can go in one box, separated by commas.
* Members you cannot place by age can be ordered with the arrows.
* **Family-only members:** a relative who uses the family tree and chat but does not pay the monthly contribution (a student, say) is marked **Family only**: tick it when adding them, or press **Make family-only** on their row. They have no ledger or balance, are never sent reminders and are not counted in the group figures. If they later start contributing, press **Make contributing**. A member who already has payments recorded cannot be made family-only.

### Step 8. Import the first real statement

1. **Import** tab: choose the statement (PDF with its password, or CSV), click **Preview**.
2. It must say **"Balance reconciles"**. If it says the balance did not reconcile, do not import; ask for help.
3. Look at the right-hand labels: a member's name (matched), "to confirm" (a guess that needs you), or "unmatched". Click **Import**.
4. **Payments** tab: go through **Needs confirmation** and **Unmatched** and give every payment to the right member. Money that is in the account but is nobody's contribution (typically a stray payment sent to your Till by mistake) is not lost: click **Mark as other income** (or set its **Type** to Other income). It stays in "Total in account", which must always equal the M-PESA balance, but it is credited to nobody, and it is listed under **Other income and notes** below the main ledger. The **Health** tab warns you if the two ever disagree.
   Other kinds of money are set with the **Type** selector on each payment: **Monthly contribution** (the normal case), **Extra contribution (booster)** (credited to the giver but does not pay off their months), **Recovery of spending** (puts back money spent in an emergency; you can name the withdrawal it replaces), **Donation from outside**, **Other income**.

### Step 9. First backup

Open the **Health** tab and click **Download full backup**. Keep the file somewhere safe (it contains phone numbers).

---

## PART 3. Sending the reminders (free, by WhatsApp)

The app does not send text messages. (Africa's Talking was removed on 11 Nov 2026: its route was blocked and a sender name costs money.) The app works out who should get the monthly reminder and report, with the exact wording, and you send each one from WhatsApp in a few taps.

### Step 10. Clean up Vercel (one time)

In Vercel, Settings, Environment Variables, **remove** `AT_API_KEY`, `AT_USERNAME`, `AT_SENDER_ID` and `SMS_LIVE` (three dots, then Remove). Nothing uses them any more. Then **Redeploy**.

### Step 11. Send the monthly reminder

1. Import the latest statement first (Part 4), so nobody who has paid is reminded.
2. Open the **Reminders** tab. Choose **Reminder** (or **Fund report**).
3. Each member who should get it has a **WhatsApp** button. Press it: WhatsApp opens with that member's message already written. Press send in WhatsApp, then come back and press the next one.
4. **Copy text** copies the message if you would rather paste it somewhere else.

You do this by hand, about once around the 7th (reminder) and once around the 15th (report).

### Step 12. Check the daily job

1. In Vercel open your project, **Settings**, then **Cron Jobs**. You should see one job for `/api/cron/daily`. (Vercel may offer a **Run** button there. If it does, press it once.)
2. In your site open **Admin, Health**. "Daily job" should turn green ("Ran ... hours ago"). It runs every morning at about 08:00 Nairobi time, with no clicking. All it does is keep the free database from going to sleep.

---

## PART 4. The monthly routine (about 10 minutes)

| When | What you do |
|---|---|
| About the **3rd to the 5th** | Request the M-PESA statement for the Till (PDF or CSV). **Import** tab: Preview, check "Balance reconciles", Import. Then clear **Needs confirmation** and **Unmatched** in the Payments tab. |
| Around the **7th** | **Reminders** tab, **Reminder**: press **WhatsApp** for each member listed. |
| About the **13th** | Import the latest statement the same way. |
| Around the **15th** | **Reminders** tab, **Fund report**: press **WhatsApp** for each member listed. |
| Once a month | **Health** tab, **Download full backup**. |

The **Health** tab shows the next reminder and report dates. The app never sends anything by itself, so nothing goes out if you forget. If the payment data is old, the Reminders tab says so: import first, so people who have already paid are not reminded.

If money was taken out and then put back, the main admin login (only that one) can erase it on the **Payments** tab, under **Cancel out a withdrawal and the deposit that put it back**: tick the withdrawal and the deposit(s) that replaced it. The M-PESA fee charged on a deposit goes with it. The deposit, less its fee, must equal the withdrawal, so the Total in account does not change; a few cents of difference stay as one line called Rounding. Nothing is kept about what was erased, and the erased M-PESA receipts are skipped if you import an old statement again.

Record bank withdrawals and other expenses (not M-PESA charges, which come in with the statement) on the **Payments** tab under Fund expenses, so the full ledger and "Total in account" stay correct.

---

## PART 5. If something goes wrong

| What you see | What to do |
|---|---|
| "Too many attempts" at login | Wait 15 minutes. More attempts only restart the wait. |
| Forgot the admin password | Vercel, Settings, Environment Variables: edit `ADMIN_PASSWORD`, then Redeploy. |
| "Balance did not reconcile" on import | Do not import. The file may be incomplete or damaged. Download the statement again, or send me the preview screenshot. |
| Imported, but payments are missing | The red message under the Import button says how many failed and why. Send it to me. Importing the same file again is safe: saved rows are skipped, so nothing is counted twice. |
| "Could not load ..." on any page | Open Vercel, your project, **Logs**, set the time to "last hour", and screenshot the red lines. |
| A WhatsApp button does not open WhatsApp | Check the member's number on the Members tab (it must be a Kenyan mobile number). Use **Copy text** and paste the message into WhatsApp yourself. |
| The Health tab shows amber or red | Read the line: each one says what to do. |
| A deploy fails | In Vercel, Deployments, click the failed one and screenshot the red text. The previous version keeps running meanwhile. |

---

## The family tree and the chat

**Before the first-visit form goes online:** run `db/009_family_profile.sql` once in the Supabase SQL Editor (see the delivery message).


* **Family tree** (menu: Family tree). It is drawn as a real tree: small cards with a photo and a name, joined by lines from parent to child, brothers and sisters side by side, children below, and **each generation has its own colour**. It opens **shrunk to fit your screen**: use the bar or the + and − buttons to zoom in (scroll to move around), **Fit to screen** to go back, or **100%** for full size. Tap a card to see more. **The first time a member opens it they are asked to fill in their details.** If they are not in the tree yet they first pick "That's me" on an entry someone already made for them, or "None of these is me: add me". Then a form opens, **already filled in with what the family has** if they have an entry. Only their **date of birth** and their **parent** are required (the parent is chosen from the list, or added with "My parent is not listed"). Everything else is optional: phone, where they studied, their work, where they live, their spouse and a few words about themselves, and **each one has a "Show to the family" tick** so they choose what the others see. They are asked once. Afterwards a **My information** box under the tree shows their own details, with **Edit my details**, **Add my child**, **Add my spouse** and (if they have no parent listed) **Add my parent**.
  * Everyone can **edit their own entry, their parent's entry and their children's entries**, and add their own child, a brother or sister, or their parent. Only you (admin) can edit anyone else or move people around.
  * Everyone chooses what the family can see: when editing, each detail has a **"Show to the family"** box. Name and photo are always shown. A detail someone hides is still visible to that person, their parent, their children and you.
  * Add a **photo** from the edit screen. It is shrunk automatically.
  * Tip: fill in **dates of birth**; the member lists and the ledger then go in order, eldest first, automatically (the date itself can be hidden).
* **Chat** (the round button at the bottom right of the home page and of the admin area). One chat with a **To:** choice at the top: **Everyone**, a particular member (a private chat that nobody else can see, not even you), or the **Admin**. The app does not text you when a member writes to you privately: unread private messages show on the **Messages** line of the **Health** tab. Messages to you appear in the same chat as extra conversations; pick one and reply. Anyone can remove their own message, and you can remove anything on the public chat.

## What is not built yet

* **Automatic M-PESA intake**: payments still arrive by importing a statement. A free option that keeps your Till (forwarding the payment SMS to the app) is being explored; it needs a few sample payment SMS from you. Daraja was dropped.

---

## PART 6. Check that everything is in place (any time)

This reads your project and your live site and tells you what, if anything, is missing. It changes nothing and shows no secrets.

1. Open **File Explorer**, go to your project folder, click the address bar, type `cmd` and press **Enter**.
2. Run:

```
node scripts/check-done.mjs
```

3. Read the last line. **ALL CHECKS PASSED** means everything is in place. Each **FAIL** line includes the command that fixes it, and **SKIP** means that item could not be checked.
4. Also run `npm test` (you should see `# fail 0`) and `npm run build` (no red "Failed to compile").

