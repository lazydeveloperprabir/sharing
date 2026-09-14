import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const PROFILE_DIR = path.resolve('.browser-profile');

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
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'];
}

async function chromeExecutable(config) {
  const configured = config.chrome?.executablePath || process.env.CHROME_PATH || '';
  if (configured && fs.existsSync(configured)) return configured;
  for (const candidate of candidateChromePaths()) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const names = process.platform === 'win32' ? ['chrome.exe', 'chrome'] : ['google-chrome', 'google-chrome-stable'];
    for (const name of names) {
      const { stdout } = await execFileAsync(command, [name]);
      const found = stdout.split(/\r?\n/).map(line => line.trim()).find(line => line && fs.existsSync(line));
      if (found) return found;
    }
  } catch {
    // Fall through to the explicit error.
  }
  throw new Error(`Google Chrome was not found. Set chrome.executablePath in config.mjs. Looked in: ${candidateChromePaths().join(', ')}`);
}

export async function launchNewChrome(config) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const options = {
    headless: false,
    viewport: null,
    args: ['--start-maximized']
  };
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_DIR, { ...options, channel: 'chrome' });
  } catch {
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      ...options,
      executablePath: await chromeExecutable(config)
    });
  }
  const page = context.pages()[0] || await context.newPage();
  console.log('Opened a new Chrome window for this script. Your existing Chrome was left alone.');
  return { context, page };
}

export default launchNewChrome;
