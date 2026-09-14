import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import config from './config.mjs';

const PROFILE_DIR = path.resolve('.browser-profile');
const RUN_LOG = path.resolve(`run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

async function getReviewerCandidates(page) {
  await page.goto(config.darwinbox.candidateListUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const rows = page.locator(config.darwinbox.rowSelector);
  const count = await rows.count();
  const candidates = [];

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const text = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!text.includes(config.darwinbox.reviewerStatus)) continue;
    const employeeId = text.match(new RegExp(config.darwinbox.employeeIdRegex))?.[0] ?? '';
    const link = row.locator(config.darwinbox.openCandidateSelector).filter({ hasText: /.+/ }).first();
    const href = await link.getAttribute('href').catch(() => null);
    const name = (await link.innerText().catch(() => '')).trim() || text.split(config.darwinbox.reviewerStatus)[0].trim();
    if (!href) throw new Error(`Could not find a candidate link in reviewer row: ${text}`);
    candidates.push({ employeeId, name, href, rowText: text });
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

async function inspectCandidate(page, candidate) {
  const candidateUrl = new URL(candidate.href, config.darwinbox.candidateListUrl).toString();
  await page.goto(candidateUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(config.darwinbox.documentPageReadyText, { exact: true }).first().waitFor({ timeout: 15000 });
  const documents = {};
  for (const documentName of config.darwinbox.requiredDocuments) {
    documents[documentName] = await documentIsUploaded(page, documentName);
  }
  const missing = Object.entries(documents).filter(([, result]) => result.value !== 'Yes').map(([name]) => name);
  return {
    ...candidate,
    documents,
    totalFiles: Object.values(documents).filter(result => result.value === 'Yes').length,
    status: missing.length ? `Incomplete - Missing: ${missing.join(', ')}` : 'Completed',
    error: missing.length ? '' : '',
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
const results = [];

try {
  const candidates = await getReviewerCandidates(page);
  const limit = Number.isFinite(config.maxCandidates) && config.maxCandidates > 0
    ? Math.floor(config.maxCandidates)
    : candidates.length;
  const toProcess = candidates.slice(0, limit);
  console.log(`Found ${candidates.length} candidate(s) pending with reviewer.`);
  if (toProcess.length < candidates.length) {
    console.log(`Processing ${toProcess.length} of ${candidates.length} (config.maxCandidates=${limit}).`);
  }
  for (const candidate of toProcess) {
    const record = await inspectCandidate(page, candidate);
    results.push(record);
    console.log(`${record.employeeId || record.name}: ${record.status}`);
    if (!config.dryRun) await updateSheet(page, record);
  }
} finally {
  fs.writeFileSync(RUN_LOG, JSON.stringify(results, null, 2));
  console.log(`Saved local audit log: ${RUN_LOG}`);
  await context.close();
}
