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
    restartIfNeeded: config.chrome?.restartIfNeeded !== false,
    executablePath: config.chrome?.executablePath || process.env.CHROME_PATH || '',
    profileDirectory: config.chrome?.profileDirectory || ''
  };
}

function cdpPort(cdpUrl) {
  try {
    return Number(new URL(cdpUrl).port) || 9222;
  } catch {
    return 9222;
  }
}

function candidateChromePaths() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium'
  ];
}

async function chromeExecutable(config) {
  const configured = chromeSettings(config).executablePath;
  if (configured && fs.existsSync(configured)) return configured;

  for (const candidate of candidateChromePaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const names = process.platform === 'win32'
      ? ['chrome.exe', 'chrome']
      : ['google-chrome', 'google-chrome-stable', 'chromium'];
    for (const name of names) {
      const { stdout } = await execFileAsync(command, [name]);
      const found = stdout.split(/\r?\n/).map(line => line.trim()).find(line => line && fs.existsSync(line));
      if (found) return found;
    }
  } catch {
    // Ignore lookup failures and fall through to the explicit error.
  }

  throw new Error(
    `Google Chrome was not found. Set chrome.executablePath in config.mjs to chrome.exe, or CHROME_PATH. Looked in: ${candidateChromePaths().join(', ')}`
  );
}

function defaultProfileDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  }
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'google-chrome');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

function readLocalState() {
  const localStatePath = path.join(defaultProfileDir(), 'Local State');
  if (!fs.existsSync(localStatePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
  } catch {
    return {};
  }
}

function resolveProfileDirectory(config) {
  const configured = chromeSettings(config).profileDirectory.trim();
  if (configured) return configured;
  const data = readLocalState();
  return data.profile?.last_used || 'Default';
}

function profileDisplayName(directory) {
  const cache = readLocalState().profile?.info_cache || {};
  return cache[directory]?.name || directory;
}

function cdpCandidates(preferredUrl) {
  const port = cdpPort(preferredUrl);
  const profilePort = portFromProfile();
  return [...new Set([
    preferredUrl,
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    profilePort ? `http://127.0.0.1:${profilePort}` : null,
    profilePort ? `http://localhost:${profilePort}` : null
  ].filter(Boolean))];
}

async function cdpAvailable(cdpUrl) {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, '')}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function findOpenCdp(preferredUrl) {
  for (const url of cdpCandidates(preferredUrl)) {
    if (await cdpAvailable(url)) return url;
  }
  return null;
}

async function waitForCdp(preferredUrl, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastNotice = 0;
  while (Date.now() < deadline) {
    const url = await findOpenCdp(preferredUrl);
    if (url) return url;
    if (Date.now() - lastNotice > 10000) {
      console.log('Waiting for Chrome. If a profile picker is on screen, click the Work / Darwinbox profile.');
      lastNotice = Date.now();
    }
    await sleep(500);
  }
  const portFile = path.join(defaultProfileDir(), 'DevToolsActivePort');
  const portFileText = fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').trim() : 'missing';
  throw new Error(
    `Chrome did not open a debug port at ${preferredUrl}. DevToolsActivePort=${portFileText}. Quit every Chrome window (check the tray), then run again.`
  );
}

async function chromeIsRunning() {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH']);
      return /chrome\.exe/i.test(stdout);
    }
    await execFileAsync('pgrep', ['-x', 'Google Chrome']);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilChromeExits(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await chromeIsRunning())) return;
    await sleep(400);
  }
  throw new Error('Chrome did not quit. Close all Chrome windows (including any in the system tray) and run again.');
}

function clearProfileLocks() {
  const profileDir = defaultProfileDir();
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const file = path.join(profileDir, name);
    try {
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    } catch {
      // Profile files may still be locked for a moment after Chrome exits.
    }
  }
}

async function quitChrome() {
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/F', '/IM', 'chrome.exe', '/T']).catch(() => {});
  } else if (process.platform === 'darwin') {
    await execFileAsync('osascript', ['-e', 'tell application "Google Chrome" to quit']).catch(() => {});
    if (await chromeIsRunning()) await execFileAsync('pkill', ['-9', '-x', 'Google Chrome']).catch(() => {});
  } else {
    await execFileAsync('pkill', ['-9', '-f', 'chrome']).catch(() => {});
  }
  await waitUntilChromeExits();
  await sleep(1500);
  clearProfileLocks();
}

async function launchChromeWithDebugging(config, port) {
  const executable = await chromeExecutable(config);
  const profileDirectory = resolveProfileDirectory(config);
  const profileName = profileDisplayName(profileDirectory);
  const args = [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--restore-last-session',
    '--no-first-run',
    '--no-default-browser-check',
    `--profile-directory=${profileDirectory}`
  ];
  console.log(`Launching Chrome profile "${profileName}" (${profileDirectory}) with debugging: ${executable}`);
  const child = spawn(executable, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: process.env
  });
  child.on('error', error => {
    console.error(`Chrome failed to start: ${error.message}`);
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
  const alreadyOpen = await findOpenCdp(cdpUrl);
  if (alreadyOpen) return alreadyOpen;

  const running = await chromeIsRunning();
  if (running && !restartIfNeeded) {
    throw new Error(
      'Chrome is already open, but it was not started with remote debugging so a tab cannot be added. Quit Chrome and run again, or set chrome.restartIfNeeded to true.'
    );
  }
  if (running) {
    console.log('Chrome is open without a debug port. Closing it, then reopening with your tabs restored...');
    await quitChrome();
  } else {
    console.log('Starting Google Chrome with your normal profile...');
  }

  await launchChromeWithDebugging(config, cdpPort(cdpUrl));
  console.log('Waiting for Chrome debug port...');
  return waitForCdp(cdpUrl);
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
