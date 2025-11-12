#!/usr/bin/env node
const { spawn, spawnSync } = require('child_process');
const { promises: fs } = require('fs');
const path = require('path');

const INPUT_DIR = 'slides';
const OUTPUT_DIR = 'docs';
const CHROMIUM_SENTINEL = path.join(
  'node_modules',
  '.cache',
  'marp-chromium-deps-installed'
);

let cachedChromiumEnv;

function getChromiumEnv() {
  if (cachedChromiumEnv) return cachedChromiumEnv;

  cachedChromiumEnv = {};

  if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
    return cachedChromiumEnv;
  }

  try {
    // Puppeteer downloads a compatible Chromium binary during installation.
    // Exposing the path through PUPPETEER_EXECUTABLE_PATH allows Marp CLI to
    // reuse the bundled browser when generating PDF, PPTX, or image outputs.
    // eslint-disable-next-line global-require
    const puppeteer = require('puppeteer');
    const executablePath =
      typeof puppeteer.executablePath === 'function'
        ? puppeteer.executablePath()
        : undefined;

    if (executablePath) {
      cachedChromiumEnv = {
        PUPPETEER_EXECUTABLE_PATH: executablePath,
        CHROME_PATH: executablePath,
      };
      return cachedChromiumEnv;
    }
  } catch (error) {
    console.warn(
      'Warning: Could not resolve a Chromium executable from Puppeteer. '
        + 'Install Google Chrome or set CHROME_PATH / PUPPETEER_EXECUTABLE_PATH '
        + 'if PDF, PPTX, or PNG generation fails.'
    );
  }

  if (!cachedChromiumEnv.PUPPETEER_EXECUTABLE_PATH) {
    try {
      // Playwright also bundles Chromium. Use it as a fallback when available.
      // eslint-disable-next-line global-require
      const { chromium } = require('playwright');
      const executablePath =
        chromium && typeof chromium.executablePath === 'function'
          ? chromium.executablePath()
          : undefined;

      if (executablePath) {
        cachedChromiumEnv = {
          PUPPETEER_EXECUTABLE_PATH: executablePath,
          CHROME_PATH: executablePath,
        };
      }
    } catch (error) {
      console.warn(
        'Warning: Could not resolve a Chromium executable from Playwright. '
          + 'Install Google Chrome or set CHROME_PATH / PUPPETEER_EXECUTABLE_PATH '
          + 'if PDF, PPTX, or PNG generation fails.'
      );
    }
  }

  return cachedChromiumEnv;
}

async function ensureChromiumDependencies() {
  if (process.platform !== 'linux') return;
  if (process.env.MARP_SKIP_CHROMIUM_DEPS === '1') return;

  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    console.warn(
      'Skipping automatic installation of Chromium dependencies because '
        + 'root privileges are required. Run `npx playwright install-deps '
        + 'chromium` manually or set MARP_SKIP_CHROMIUM_DEPS=1 to skip '
        + 'this check.'
    );
    return;
  }

  if (spawnSync('which', ['apt-get']).status !== 0) return;

  try {
    await fs.access(CHROMIUM_SENTINEL);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  console.log(
    'Installing Chromium system dependencies via Playwright '
      + '(`playwright install-deps chromium`)...'
  );

  const playwrightBin = path.resolve(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
  );

  let result = spawnSync(playwrightBin, ['install-deps', 'chromium'], {
    stdio: 'inherit',
  });

  if (result.error && result.error.code === 'ENOENT') {
    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    result = spawnSync(
      npxCommand,
      ['--yes', 'playwright', 'install-deps', 'chromium'],
      { stdio: 'inherit' }
    );
  }

  if (result.status === 0) {
    await fs.mkdir(path.dirname(CHROMIUM_SENTINEL), { recursive: true });
    await fs.writeFile(CHROMIUM_SENTINEL, '');
  } else {
    console.warn(
      'Failed to install Chromium dependencies automatically. ' +
        'The build may continue to fail if Chromium cannot start. ' +
        'Install the dependencies manually or set MARP_SKIP_CHROMIUM_DEPS=1 '
        + 'to skip this step.'
    );
  }
}

async function runMarp(additionalArgs = []) {
  await new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const marp = spawn(
      command,
      ['marp', '--config', 'marp.config.js', ...additionalArgs],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          CHROME_NO_SANDBOX: '1',
          ...getChromiumEnv(),
        },
      }
    );

    marp.on('error', reject);
    marp.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Marp build failed with exit code ${code}`));
    });
  });
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyAssets(fromDir, toDir) {
  const entries = await fs.readdir(fromDir, { withFileTypes: true });

  for (const entry of entries) {
    const fromPath = path.join(fromDir, entry.name);
    const toPath = path.join(toDir, entry.name);

    if (entry.isDirectory()) {
      await copyAssets(fromPath, toPath);
      continue;
    }

    if (path.extname(entry.name).toLowerCase() === '.md') {
      continue;
    }

    await ensureDir(path.dirname(toPath));
    await fs.copyFile(fromPath, toPath);
  }
}

async function main() {
  await ensureChromiumDependencies();
  const conversions = [
    { label: 'HTML', args: [] },
    { label: 'PDF', args: ['--pdf', '--no-html'] },
    { label: 'PPTX', args: ['--pptx', '--no-html'] },
    { label: 'PNG', args: ['--image', 'png', '--no-html'] },
  ];

  for (const conversion of conversions) {
    console.log(`Running Marp for ${conversion.label} output...`);
    await runMarp(conversion.args);
  }
  await copyAssets(INPUT_DIR, OUTPUT_DIR);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
