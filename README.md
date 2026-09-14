# Darwinbox Document Tracker (no APIs)

This is a browser automation. It reads the normal Darwinbox page and updates the normal Google Sheets page by simulating browser navigation and typing. It does **not** call Darwinbox or Google APIs and it does not download employee documents.

## What it does

1. Opens Darwinbox **Onboarding in Progress**.
2. Selects only rows whose overall onboarding status is `Pending With Reviewer`.
3. Opens each selected candidate and checks configured document fields. `maxCandidates` in the config caps how many are opened.
4. Treats an uploaded filename/action as `Yes` and `No file chosen` as `No`.
5. Finds the candidate's Employee ID in the existing `Document Tracker` Google Sheet and updates only the mapped document/status cells.

The script is intentionally set to a safe **dry run** initially. It processes only `maxCandidates` matching reviewer rows (default `1`), logs results locally, and makes no Sheet edits until you set `dryRun: false`.

## One-time setup

1. Install Node.js 20 or later from [nodejs.org](https://nodejs.org/). Node is already installed on this computer.
2. Open Terminal in this folder and run:

   ```bash
   npm install
   npx playwright install chromium
   ```

3. Copy the template:

   ```bash
   cp config.example.mjs config.mjs
   ```

4. In `config.mjs`, set:
   - `darwinbox.candidateListUrl` to the actual Darwinbox candidate-list URL.
   - `sheets.url` to the URL of the existing Document Tracker sheet.
   - `requiredDocuments` to the final mandatory-documents list.
   - `employeeIdRegex` if the example does not match your IDs.
   - `maxCandidates` if you want more than one test record (`null` processes every match).

5. Run the safe test:

   ```bash
   npm run run
   ```

Chrome opens with a separate `.browser-profile`. The first time it will stop on the SSO/login screen and **wait** while you sign in; it will not close the browser until login finishes. The profile retains your signed-in session, but no password is stored in this project.

6. Check the terminal and the `run-*.json` audit log. An empty `results` array means no reviewer row was processed; `listPage.sampleRows`, `error`, and the matching `run-*.png` screenshot show what Darwinbox actually rendered. Confirm the candidate names, Employee IDs and document results are correct.

7. In `config.mjs`, set `dryRun: false` and `maxCandidates: null`, then run it again. The script will update the Sheet using the normal Google Sheets interface.

## Important checks before enabling writes

- Verify that **Employee ID** is present in both Darwinbox list rows and column A in the Sheet. Do not turn off dry-run if IDs cannot be matched.
- `maxCandidates` defaults to `1`. Confirm that one result before raising the limit or turning writes on.
- Do not include Aadhaar/PAN numbers in the Sheet. This script records only `Yes`/`No` document availability.
- If Darwinbox shows an OTP, CAPTCHA, or unexpected security dialog, complete it yourself and rerun. The script does not bypass security controls.

## Scheduling (after testing)

Use macOS Automator/Calendar or a scheduled Terminal command to run `npm run run` once each morning. The Mac must be awake, online, and have an active Darwinbox and Google login. Leave Chrome closed while the script runs, because it uses its own profile.

## If the first dry run fails

Darwinbox layouts can vary by company configuration. The script deliberately stops rather than guessing. Send the terminal error and a redacted screenshot of the relevant page; usually only `rowSelector`, `openCandidateSelector`, the Employee ID pattern, or a document label needs adjustment.
