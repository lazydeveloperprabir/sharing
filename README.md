# Darwinbox Document Tracker (no APIs)

This is a browser automation. It reads the normal Darwinbox page and updates the normal Google Sheets page by simulating browser navigation and typing. It does **not** call Darwinbox or Google APIs and it does not download employee documents.

## What it does

1. Opens Darwinbox **Onboarding in Progress**.
2. Selects only rows whose overall onboarding status is `Pending With Reviewer`.
3. Opens every selected candidate and checks configured document fields.
4. Treats an uploaded filename/action as `Yes` and `No file chosen` as `No`.
5. Finds the candidate's Employee ID in the existing `Document Tracker` Google Sheet and updates only the mapped document/status cells.

The script is intentionally set to a safe **dry run** initially. It logs results locally but makes no Sheet edits until you set `dryRun: false`.

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

5. Run the safe test:

   ```bash
   npm run run
   ```

Chrome opens with a separate `.browser-profile`. Sign in to Darwinbox and Google the first time. The profile retains your normal signed-in session, but no password is stored in this project.

6. Check the terminal and the `run-*.json` audit log. Confirm the candidate names, Employee IDs and document results are correct.

7. In `config.mjs`, set `dryRun: false`, then run it again. The script will update the Sheet using the normal Google Sheets interface.

## Important checks before enabling writes

- Verify that **Employee ID** is present in both Darwinbox list rows and column A in the Sheet. Do not turn off dry-run if IDs cannot be matched.
- The first run should be performed with one test candidate only. Temporarily add that ID to the review list or make the reviewer list contain just one candidate.
- Do not include Aadhaar/PAN numbers in the Sheet. This script records only `Yes`/`No` document availability.
- If Darwinbox shows an OTP, CAPTCHA, or unexpected security dialog, complete it yourself and rerun. The script does not bypass security controls.

## Scheduling (after testing)

Use macOS Automator/Calendar or a scheduled Terminal command to run `npm run run` once each morning. The Mac must be awake, online, and have an active Darwinbox and Google login. Leave Chrome closed while the script runs, because it uses its own profile.

## If the first dry run fails

Darwinbox layouts can vary by company configuration. The script deliberately stops rather than guessing. Send the terminal error and a redacted screenshot of the relevant page; usually only `rowSelector`, `openCandidateSelector`, the Employee ID pattern, or a document label needs adjustment.
