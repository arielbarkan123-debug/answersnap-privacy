# Kindergarten Manager

A simple Windows program for keeping your kindergarten's records:

* **Children** – name, date of birth, group, enrolment date, monthly fee, allergies, medical notes
* **Parents / guardians** – any number per child: phone, email, address, workplace, emergency contact, who may pick the child up (and "copy from sibling" so you don't retype)
* **Payments** – record every payment, add extra charges (registration, trips…), see who owes money, month-by-month status, and print a receipt
* **Reports** – "Monthly overview" for any month, plus export of children and payments to Excel (CSV)

Everything is stored **only on your laptop** – nothing is sent to the internet.

## Installing on Windows

1. Open the **Actions** tab of this repository on GitHub → click the latest green run of
   **"Build Kindergarten Manager (Windows)"** → under **Artifacts** download **KindergartenManager-Windows** (a zip).
2. Unzip it. You get two files:
   * `KindergartenManager-Setup-1.0.0.exe` – installs the program (Start menu + desktop shortcut). **Use this one.**
   * `KindergartenManager-Portable-1.0.0.exe` – runs without installing (e.g. from a USB stick).
3. Double-click the Setup file. Windows may show a blue **"Windows protected your PC"** screen because the program is
   not digitally signed (signing costs money and is meant for software sold to the public). Click **More info → Run anyway**.

## Your data and backups

* Saved automatically after every change (look for **Saved ✓** at the top right).
* Location: `%APPDATA%\Kindergarten Manager\kindergarten-data.json` (paste that into the Windows Explorer address bar).
  *Settings → Open data folder* takes you there.
* The program also keeps a **daily automatic backup** (last 60 days) in the `backups` folder next to it.
* **Please also press "Backup" regularly** (e.g. weekly) and keep the file on a USB stick or cloud drive. If the laptop is lost or
  breaks, the automatic backups go with it. **"Restore"** loads such a file again (the current data is kept first).
* The data contains personal details of children and families – protect the laptop with a Windows password.

## For developers

```
npm install
npm start        # run the app
npm test         # unit tests for the fee/balance logic
npm run dist     # build the Windows installer (run on Windows; GitHub Actions does this automatically)
```

`src/index.html` also works when opened directly in a browser (data is then kept in that browser's storage instead of a file).

### How balances work

For each child: **due** = monthly fee × number of months from the enrolment month up to the current month (or the month they left)
\+ extra charges; **balance** = due − everything paid. A positive balance means the family owes money; negative means credit.

**Limitation:** each child has one monthly fee. If you change it, *all* months are recalculated with the new fee (past months
included). To raise a price from a certain month only, a fee history would need to be added to the program.
