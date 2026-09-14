import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.mjs';

const PROFILE_DIR = path.resolve('.browser-profile');
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_LOG = path.resolve(`run-${RUN_STAMP}.json`);
const RUN_SCREENSHOT = path.resolve(`run-${RUN_STAMP}.png`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const matchesStatus = text => text.toLowerCase().includes(config.darwinbox.reviewerStatus.toLowerCase());
const LOGIN_HINT = /sso|\/login\b|signin|sign-in|sign_in|auth0|okta|saml|microsoftonline|accounts\.google|oauth|adfs|onelogin|idp\./i;

function assertConfigured() {
  if (config.darwinbox.candidateListUrl.includes('YOUR-COMPANY')) {
    throw new Error('Set darwinbox.candidateListUrl in config.mjs first.');
  }
  if (config.sheets.url.includes('PASTE_YOUR_SHEET_ID')) {
    throw new Error('Set sheets.url in config.mjs first.');
  }
}

function columnLetter(columnNumber) {
  let output = '';
  for (let number = columnNumber; number > 0; number = Math.floor((number - 1) / 26)) {
    output = String.fromCharCode(65 + ((number - 1) % 26)) + output;
  }
  return output;
}

async function isLoginScreen(page) {
  const url = page.url();
  const title = await page.title().catch(() => '');
  if (LOGIN_HINT.test(`${url} ${title}`)) return true;
  if (await page.getByText(config.darwinbox.reviewerStatus, { exact: false }).count()) return false;
  const loginFields = page.locator('input[type="password"], input[name="loginfmt"], input[name="username"], input[type="email"]');
  return (await loginFields.count()) > 0;
}

async function waitForManualLogin(page) {
  if (!(await isLoginScreen(page))) return;

  const timeout = Number.isFinite(config.loginTimeoutMs) ? config.loginTimeoutMs : 0;
  const deadline = timeout > 0 ? Date.now() + timeout : Infinity;
  console.log(`SSO/login screen detected: ${page.url()}`);
  console.log(timeout > 0
    ? `Sign in in the Chrome window. Waiting up to ${Math.round(timeout / 1000)}s; the browser will stay open.`
    : 'Sign in in the Chrome window. The script will wait and will not close the browser until login finishes.');

  let lastNotice = Date.now();
  while (Date.now() < deadline) {
    await sleep(1000);
    if (!(await isLoginScreen(page))) {
      console.log('Login finished.');
      return;
    }
    if (Date.now() - lastNotice > 15000) {
      console.log('Still waiting for you to complete SSO...');
      lastNotice = Date.now();
    }
  }
  throw new Error(`Timed out waiting for SSO/login after ${timeout}ms. Sign in in Chrome and run again.`);
}

async function listPageDebug(page, extra = {}) {
  const rows = page.locator(config.darwinbox.rowSelector);
  const rowCount = await rows.count();
  const sampleRows = [];
  for (let index = 0; index < Math.min(rowCount, 20); index += 1) {
    const text = (await rows.nth(index).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text) sampleRows.push(text.slice(0, 300));
  }
  const bodyPreview = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    rowCount,
    sampleRows,
    bodyPreview,
    lookedForStatus: config.darwinbox.reviewerStatus,
    ...extra
  };
}

async function readCandidateFromRow(row, text) {
  const employeeId = text.match(new RegExp(config.darwinbox.employeeIdRegex))?.[0] ?? '';
  const link = row.locator(config.darwinbox.openCandidateSelector).filter({ hasText: /.+/ }).first();
  const href = await link.getAttribute('href', { timeout: 2000 }).catch(() => null);
  const name = (await link.innerText({ timeout: 2000 }).catch(() => '')).trim()
    || text.split(new RegExp(config.darwinbox.reviewerStatus, 'i'))[0].trim();
  return { employeeId, name, href, rowText: text };
}

async function getReviewerCandidates(page) {
  await page.goto(config.darwinbox.candidateListUrl, { waitUntil: 'domcontentloaded' });
  await waitForManualLogin(page);
  await page.goto(config.darwinbox.candidateListUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  await page.getByText(config.darwinbox.reviewerStatus, { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {});

  const rows = page.locator(config.darwinbox.rowSelector);
  const count = await rows.count();
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!matchesStatus(text)) continue;
    candidates.push(await readCandidateFromRow(row, text));
  }

  if (!candidates.length) {
    const statusHits = page.getByText(config.darwinbox.reviewerStatus, { exact: false });
    const hitCount = await statusHits.count();
    const seen = new Set();
    for (let index = 0; index < Math.min(hitCount, 50); index += 1) {
      const hit = statusHits.nth(index);
      const row = hit.locator('xpath=ancestor::tr[1]').or(hit.locator('xpath=ancestor::*[@role="row"][1]')).first();
      const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
        || (await hit.evaluate(element => (element.parentElement?.innerText || element.innerText || '')).catch(() => '')).replace(/\s+/g, ' ').trim();
      if (!matchesStatus(text) || seen.has(text)) continue;
      seen.add(text);
      candidates.push(await readCandidateFromRow(row, text));
    }
  }

  return candidates;
}

async function documentIsUploaded(page, label) {
  const labels = page.getByText(label, { exact: true });
  const labelCount = await labels.count();
  if (!labelCount) return { value: 'No', reason: 'field not found' };

  // Darwinbox renders document labels within a nearby card. Search a few ancestor levels
  // and stop at the smallest container that has a file input or the "No file chosen" text.
  const result = await labels.first().evaluate((labelElement, missingText) => {
    let element = labelElement;
    for (let level = 0; level < 7 && element; level += 1, element = element.parentElement) {
      const content = element.innerText || '';
      if (content.includes(missingText) || element.querySelector('input[type="file"]')) {
        const missing = content.includes(missingText);
        // Uploaded Darwinbox cards visibly include a filename / document action; empty cards do not.
        const hasFileLink = Boolean(element.querySelector('a[href], [class*="download" i], [class*="delete" i], [class*="remove" i]'));
        return { missing, hasFileLink, content: content.slice(0, 500) };
      }
    }
    return null;
  }, config.darwinbox.missingText);

  if (!result) return { value: 'No', reason: 'document card not found' };
  return result.missing && !result.hasFileLink
    ? { value: 'No', reason: 'No file chosen' }
    : { value: 'Yes', reason: 'uploaded file action found' };
}

async function openCandidate(page, candidate) {
  if (candidate.href && candidate.href !== '#') {
    const candidateUrl = new URL(candidate.href, config.darwinbox.candidateListUrl).toString();
    await page.goto(candidateUrl, { waitUntil: 'domcontentloaded' });
    return;
  }
  await page.goto(config.darwinbox.candidateListUrl, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  const needle = candidate.employeeId || candidate.name;
  if (!needle) throw new Error(`Could not open candidate; no href, Employee ID, or name in row: ${candidate.rowText}`);
  const row = page.locator(config.darwinbox.rowSelector).filter({ hasText: needle }).first();
  await row.locator(config.darwinbox.openCandidateSelector).filter({ hasText: /.+/ }).first().click({ timeout: 8000 });
}

async function inspectCandidate(page, candidate) {
  await openCandidate(page, candidate);
  await page.getByText(config.darwinbox.documentPageReadyText, { exact: false }).first().waitFor({ timeout: 15000 });
  const documents = {};
  for (const documentName of config.darwinbox.requiredDocuments) {
    documents[documentName] = await documentIsUploaded(page, documentName);
  }
  const missing = Object.entries(documents).filter(([, result]) => result.value !== 'Yes').map(([name]) => name);
  return {
    ...candidate,
    url: page.url(),
    documents,
    totalFiles: Object.values(documents).filter(result => result.value === 'Yes').length,
    status: missing.length ? `Incomplete - Missing: ${missing.join(', ')}` : 'Completed',
    error: '',
    processedDate: new Date().toLocaleString('en-IN', { hour12: false })
  };
}

async function gotoCell(page, reference) {
  const nameBox = page.locator('input[aria-label="Name box"], input[aria-label*="Name box" i]').first();
  await nameBox.waitFor({ timeout: 15000 });
  await nameBox.fill(reference);
  await page.keyboard.press('Enter');
  await sleep(300);
}

async function findEmployeeRow(page, employeeId) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await page.keyboard.insertText(employeeId);
  await page.keyboard.press('Enter');
  await sleep(400);
  await page.keyboard.press('Escape');
  const selected = page.locator('[aria-selected="true"]').filter({ has: page.locator('[role="gridcell"]') }).first();
  const label = await selected.getAttribute('aria-label').catch(() => null);
  const matched = label?.match(/([A-Z]+)(\d+)/i);
  if (!matched) throw new Error(`Google Sheets could not identify the row for Employee ID ${employeeId}.`);
  return Number(matched[2]);
}

async function writeCell(page, column, row, value) {
  await gotoCell(page, `${columnLetter(column)}${row}`);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.keyboard.insertText(String(value));
  await page.keyboard.press('Enter');
}

async function updateSheet(page, record) {
  await page.goto(config.sheets.url, { waitUntil: 'domcontentloaded' });
  await waitForManualLogin(page);
  await page.goto(config.sheets.url, { waitUntil: 'domcontentloaded' });
  await page.getByText(config.sheets.tabName, { exact: true }).first().click().catch(() => {});
  const row = await findEmployeeRow(page, record.employeeId);
  const values = {
    employeeName: record.name,
    totalFiles: record.totalFiles,
    status: record.status,
    error: record.error,
    processedDate: record.processedDate,
    ...Object.fromEntries(Object.entries(record.documents).map(([name, result]) => [name, result.value]))
  };
  for (const [field, value] of Object.entries(values)) {
    const column = config.sheets.columns[field];
    if (!column) continue;
    await writeCell(page, column, row, value);
  }
}

assertConfigured();
const context = await chromium.launchPersistentContext(PROFILE_DIR, { channel: 'chrome', headless: false, viewport: null });
const page = context.pages()[0] || await context.newPage();
const audit = {
  startedAt: new Date().toISOString(),
  dryRun: config.dryRun,
  maxCandidates: config.maxCandidates ?? null,
  listPage: null,
  candidatesFound: 0,
  results: [],
  error: '',
  screenshot: ''
};

try {
  const candidates = await getReviewerCandidates(page);
  audit.listPage = await listPageDebug(page, { candidatesFound: candidates.length });
  audit.candidatesFound = candidates.length;
  const limit = Number.isFinite(config.maxCandidates) && config.maxCandidates > 0
    ? Math.floor(config.maxCandidates)
    : candidates.length;
  const toProcess = candidates.slice(0, limit);
  console.log(`Found ${candidates.length} candidate(s) pending with reviewer.`);
  if (toProcess.length < candidates.length) {
    console.log(`Processing ${toProcess.length} of ${candidates.length} (config.maxCandidates=${limit}).`);
  }
  if (!candidates.length) {
    audit.error = `No rows matched "${config.darwinbox.reviewerStatus}". Check login, the list URL, rowSelector, and the sampleRows in this log.`;
    console.error(audit.error);
  }
  for (const candidate of toProcess) {
    try {
      const record = await inspectCandidate(page, candidate);
      audit.results.push(record);
      console.log(`${record.employeeId || record.name}: ${record.status}`);
      if (!config.dryRun) await updateSheet(page, record);
    } catch (error) {
      const failed = {
        ...candidate,
        documents: {},
        totalFiles: 0,
        status: 'Error',
        error: error.message,
        processedDate: new Date().toLocaleString('en-IN', { hour12: false })
      };
      audit.results.push(failed);
      audit.error = audit.error || error.message;
      console.error(`${candidate.employeeId || candidate.name || 'candidate'}: ${error.message}`);
    }
  }
} catch (error) {
  audit.error = error.message;
  console.error(error);
  try {
    audit.listPage = await listPageDebug(page);
  } catch {
    audit.listPage = { url: page.url(), title: await page.title().catch(() => '') };
  }
} finally {
  try {
    await page.screenshot({ path: RUN_SCREENSHOT, fullPage: true });
    audit.screenshot = RUN_SCREENSHOT;
  } catch {
    audit.screenshot = '';
  }
  fs.writeFileSync(RUN_LOG, JSON.stringify(audit, null, 2));
  console.log(`Saved local audit log: ${RUN_LOG}`);
  await context.close();
}
