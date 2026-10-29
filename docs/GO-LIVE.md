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
* **Site address**: `https://family-fund-app-nine.vercel.app` (it goes in every text message as the link).
* **Your phone number, for reminders to import the statement**: your own mobile number. This is where the app texts you when the payment data is getting old.
* **Hold the automatic texts if the payment data is older than (days)**: leave at 4.
* **Message wording** for the reminder and the report. Read both. They must include the balance and the site link.

### Step 7. Members tab

* Check all 16 members are listed with the right primary phone.
* For anyone who sometimes pays from another number, open them and fill in: **other phone numbers**, **till or business numbers they pay from**, and **numbers as shown on statements** (like `254110***358`). Several numbers can go in one box, separated by commas.
* Members you cannot place by age can be ordered with the arrows.

### Step 8. Import the first real statement

1. **Import** tab: choose the statement (PDF with its password, or CSV), click **Preview**.
2. It must say **"Balance reconciles"**. If it says the balance did not reconcile, do not import; ask for help.
3. Look at the right-hand labels: a member's name (matched), "to confirm" (a guess that needs you), or "unmatched". Click **Import**.
4. **Payments** tab: go through **Needs confirmation** and **Unmatched** and give every payment to the right member. Money that is in the account but is nobody's contribution (typically a stray payment sent to your Till by mistake) is not lost: click **Mark as other income** (or set its **Type** to Other income). It stays in "Total in account", which must always equal the M-PESA balance, but it is credited to nobody, and it is listed under **Other income and notes** below the main ledger. The **Health** tab warns you if the two ever disagree.
   Other kinds of money are set with the **Type** selector on each payment: **Monthly contribution** (the normal case), **Extra contribution (booster)** (credited to the giver but does not pay off their months), **Recovery of spending** (puts back money spent in an emergency; you can name the withdrawal it replaces), **Donation from outside**, **Other income**.

### Step 9. First backup

Open the **Health** tab and click **Download full backup**. Keep the file somewhere safe (it contains phone numbers).

---

## PART 3. Switch on the texts

### Step 10. Africa's Talking

1. Sign in at africastalking.com and open your app `familyfundapp`.
2. **Settings, then API Key:** generate a key and copy it (it is usually shown only once).
3. **Billing or Top Up:** add credit (KES 200 to 500 is plenty to start).

### Step 11. Put the texting settings into Vercel

In Vercel, Settings, Environment Variables, add (or edit):

| Name | Value |
|---|---|
| `AT_USERNAME` | `familyfundapp` |
| `AT_API_KEY` | your key from Step 10 |
| `SMS_LIVE` | `true` |

Leave the sender ID setting empty. Then **Redeploy** (Step 3d, parts 1 and 2).

### Step 12. Send one test text to yourself first

1. **Reminders** tab. Untick everyone except **yourself or one trusted member**.
2. Click **Send**. The banner at the top must say live sending is **ON**.
3. Check that the text arrives and reads correctly, with the balance and the link.
4. Only then select everyone you want to text.

### Step 13. Check the automatic daily job

1. In Vercel open your project, **Settings**, then **Cron Jobs**. You should see one job for `/api/cron/daily`. (Vercel may offer a **Run** button there. If it does, press it once.)
2. In your site open **Admin, Health**. "Daily job" should turn green ("Ran ... hours ago"). It runs every morning at about 08:00 Nairobi time, with no clicking.

---

## PART 4. The monthly routine (about 10 minutes)

| When | What happens by itself | What you do |
|---|---|---|
| About the **3rd to the 5th** | The app texts you if the payment data is old ("please import the latest statement") | Request the M-PESA statement for the Till (PDF or CSV). **Import** tab: Preview, check "Balance reconciles", Import. Then clear **Needs confirmation** and **Unmatched** in the Payments tab. |
| The **7th**, 08:00 | The arrears reminder goes to members who owe money | Nothing. |
| About the **13th** | The app texts you if the data is old again | Import the latest statement the same way. |
| The **15th**, 08:00 | The fund report goes to everyone (collected this month, total in account, their own balance) | Nothing. |
| Once a month | | **Health** tab, **Download full backup**. |

If you forget to import, the automatic text **waits** instead of reminding people who have already paid. It goes out on the next daily run after you import, as long as that is within two days of its day.

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
| A text did not arrive | **Reminders** tab, bottom list **Recent messages**: it shows sent, failed or dry run, with the reason. Check Africa's Talking has credit. Meanwhile each ready message has a **WhatsApp** link you can use by hand. |
| The Health tab shows amber or red | Read the line: each one says what to do. |
| A deploy fails | In Vercel, Deployments, click the failed one and screenshot the red text. The previous version keeps running meanwhile. |

---

## The family tree and the chat

* **Family tree** (menu: Family tree). It is drawn as a real tree: small cards with a photo and a name, joined by lines from parent to child, brothers and sisters side by side, children below, and **each generation has its own colour**. It opens **shrunk to fit your screen**: use the bar or the + and − buttons to zoom in (scroll to move around), **Fit to screen** to go back, or **100%** for full size. Tap a card to see more. The first time a member opens it they are asked "Where are you in the family?" and pick their place (take over an entry that is them, or add themselves under their parent).
  * Everyone can **edit their own entry, their parent's entry and their children's entries**, and add their own child, a brother or sister, or their parent. Only you (admin) can edit anyone else or move people around.
  * Everyone chooses what the family can see: when editing, each detail has a **"Show to the family"** box. Name and photo are always shown. A detail someone hides is still visible to that person, their parent, their children and you.
  * Add a **photo** from the edit screen. It is shrunk automatically.
  * Tip: fill in **dates of birth**; the member lists and the ledger then go in order, eldest first, automatically (the date itself can be hidden).
* **Chat** (the round button at the bottom right of the home page and of the admin area). One chat with a **To:** choice at the top: **Everyone**, a particular member (a private chat that nobody else can see, not even you), or the **Admin**. You get a **text message** when a member writes to you privately (to the phone number in Setup, and to any member you marked as an admin). Messages to you appear in the same chat as extra conversations; pick one and reply. Anyone can remove their own message, and you can remove anything on the public chat.

## What is not built yet

* **Automatic M-PESA intake**: payments still arrive by importing a statement. A free option that keeps your Till (forwarding the payment SMS to the app) is being explored; it needs a few sample payment SMS from you. Daraja was dropped.
