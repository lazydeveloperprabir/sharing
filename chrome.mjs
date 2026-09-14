import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function chromeSettings(config) {
  return {
    cdpUrl: config.chrome?.cdpUrl || 'http://127.0.0.1:9222',
    restartIfNeeded: config.chrome?.restartIfNeeded !== false
  };
}

function cdpPort(cdpUrl) {
  try {
    return Number(new URL(cdpUrl).port) || 9222;
  } catch {
    return 9222;
  }
}

function chromeExecutable() {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (fs.existsSync(mac)) return mac;
  throw new Error('Google Chrome was not found in /Applications.');
}

function defaultProfileDir() {
  return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
}

async function cdpAvailable(cdpUrl) {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, '')}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(cdpUrl, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdpAvailable(cdpUrl)) return;
    await sleep(400);
  }
  throw new Error(`Chrome did not open a debug port at ${cdpUrl}.`);
}

async function chromeIsRunning() {
  try {
    await execFileAsync('pgrep', ['-x', 'Google Chrome']);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilChromeExits(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await chromeIsRunning())) return;
    await sleep(400);
  }
  throw new Error('Chrome did not quit. Quit Google Chrome once and run again.');
}

async function quitChrome() {
  await execFileAsync('osascript', ['-e', 'tell application "Google Chrome" to quit']);
  await waitUntilChromeExits();
}

function launchChromeWithDebugging(port) {
  const child = spawn(chromeExecutable(), [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--restore-last-session'
  ], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
}

function portFromProfile() {
  const portFile = path.join(defaultProfileDir(), 'DevToolsActivePort');
  if (!fs.existsSync(portFile)) return null;
  const firstLine = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0]?.trim();
  const port = Number(firstLine);
  return Number.isInteger(port) && port > 0 ? port : null;
}

async function ensureChromeDebugging(config) {
  const { cdpUrl, restartIfNeeded } = chromeSettings(config);
  if (await cdpAvailable(cdpUrl)) return cdpUrl;

  const profilePort = portFromProfile();
  if (profilePort) {
    const profileUrl = `http://127.0.0.1:${profilePort}`;
    if (await cdpAvailable(profileUrl)) return profileUrl;
  }

  const running = await chromeIsRunning();
  if (running && !restartIfNeeded) {
    throw new Error(
      'Chrome is already open, but it was not started with remote debugging so a tab cannot be added. Quit Chrome and run again, or set chrome.restartIfNeeded to true.'
    );
  }
  if (running) {
    console.log('Chrome is open but cannot be controlled. Restarting it once with your tabs restored so a new tab can be added.');
    await quitChrome();
  } else {
    console.log('Starting Google Chrome with your normal profile...');
  }

  launchChromeWithDebugging(cdpPort(cdpUrl));
  await waitForCdp(cdpUrl);
  return cdpUrl;
}

export async function connectToExistingChrome(config) {
  const cdpUrl = await ensureChromeDebugging(config);
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome is open, but no window was available to add a tab.');
  const page = await context.newPage();
  console.log('Added a tab in your existing Chrome window. Chrome will stay open after the run.');
  return { browser, context, page };
}
