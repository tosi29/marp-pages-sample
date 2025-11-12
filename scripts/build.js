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
        + 'if PDF or PPTX generation fails.'
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
          + 'if PDF or PPTX generation fails.'
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

async function ensureNoJekyll() {
  const filePath = path.join(OUTPUT_DIR, '.nojekyll');
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, '');
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

function toTitleCase(value) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function extractDeckTitle(markdownPath, slug) {
  try {
    const raw = await fs.readFile(markdownPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let index = 0;

    if (lines[index] && lines[index].trim() === '---') {
      index += 1;
      while (index < lines.length && lines[index].trim() !== '---') {
        index += 1;
      }
      if (lines[index] && lines[index].trim() === '---') index += 1;
    }

    while (index < lines.length) {
      const line = lines[index].trim();
      if (line.startsWith('#')) {
        return line.replace(/^#+\s*/, '').trim() || toTitleCase(slug);
      }
      index += 1;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return toTitleCase(slug);
}

async function collectDecks() {
  const decksByMember = [];
  let memberDirs;

  try {
    memberDirs = await fs.readdir(INPUT_DIR, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return decksByMember;
    throw error;
  }

  for (const memberDir of memberDirs) {
    if (!memberDir.isDirectory()) continue;

    const memberId = memberDir.name;
    const memberPath = path.join(INPUT_DIR, memberId);
    const deckEntries = [];
    const deckDirs = await fs.readdir(memberPath, { withFileTypes: true });

    for (const deckDir of deckDirs) {
      if (!deckDir.isDirectory()) continue;
      const slug = deckDir.name;
      const markdownPath = path.join(memberPath, slug, 'index.md');
      const title = await extractDeckTitle(markdownPath, slug);

      deckEntries.push({
        slug,
        title,
      });
    }

    if (deckEntries.length > 0) {
      deckEntries.sort((a, b) => a.title.localeCompare(b.title));
      decksByMember.push({
        memberId,
        memberLabel: toTitleCase(memberId),
        decks: deckEntries,
      });
    }
  }

  decksByMember.sort((a, b) => a.memberLabel.localeCompare(b.memberLabel));
  return decksByMember;
}

function encodePathSegment(value) {
  return encodeURIComponent(value);
}

function renderDeckList(decksByMember) {
  const memberSections = decksByMember
    .map(({ memberId, memberLabel, decks }) => {
      const deckItems = decks
        .map(({ slug, title }) => {
          const escapedTitle = escapeHtml(title);
          const basePath = `${encodePathSegment(memberId)}/${encodePathSegment(slug)}`;
          const escapedBasePath = escapeHtml(basePath);

          return `
          <li class="deck-entry">
            <a class="deck-title" href="${escapedBasePath}/">${escapedTitle}</a>
            <span class="deck-links" aria-label="Available formats">
              <a href="${escapedBasePath}/">HTML</a>
              <a href="${escapedBasePath}/index.pdf">PDF</a>
              <a href="${escapedBasePath}/index.pptx">PPTX</a>
            </span>
          </li>`;
        })
        .join('');

      return `
      <li>
        <strong>${escapeHtml(memberLabel)}</strong>
        <ul class="deck-list">
          ${deckItems}
        </ul>
      </li>`;
    })
    .join('');

  return `
    <ul class="member-list">
      ${memberSections || '<li><em>No decks found. Run <code>npm run build</code> to generate slides.</em></li>'}
    </ul>`;
}

async function writeIndex(decksByMember) {
  const indexPath = path.join(OUTPUT_DIR, 'index.html');
  const deckListMarkup = renderDeckList(decksByMember);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Team slide decks</title>
    <meta name="description" content="Auto-generated index of Marp decks for GitHub Pages." />
    <style>
      body {
        font-family: 'Noto Sans', system-ui, sans-serif;
        margin: 2rem auto;
        max-width: 720px;
        line-height: 1.6;
        color: #24292e;
      }
      h1 {
        color: #0969da;
        margin-bottom: 1rem;
      }
      a {
        text-decoration: none;
        color: #0969da;
        font-weight: 600;
      }
      a:hover {
        text-decoration: underline;
      }
      code {
        background: #f6f8fa;
        padding: 0.1rem 0.3rem;
        border-radius: 4px;
      }
      .member-list {
        list-style: none;
        padding-left: 0;
      }
      .member-list > li {
        margin-bottom: 1.5rem;
      }
      .deck-list {
        list-style: none;
        padding-left: 0;
        margin: 0.5rem 0 0;
      }
      .deck-entry {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: baseline;
        margin-bottom: 0.4rem;
      }
      .deck-title {
        font-weight: 600;
      }
      .deck-links {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.3rem;
        font-size: 0.9rem;
        color: #57606a;
      }
      .deck-links::before {
        content: '(';
        color: #8c959f;
      }
      .deck-links::after {
        content: ')';
        color: #8c959f;
      }
      .deck-links a {
        font-weight: 500;
      }
      .deck-links a + a::before {
        content: '·';
        color: #8c959f;
        margin: 0 0.2rem 0 0.1rem;
      }
    </style>
  </head>
  <body>
    <p class="generated-note">This page is auto-generated by <code>scripts/build.js</code>. Do not edit manually.</p>
    <h1>Team slide decks</h1>
    <p>
      Each deck is generated from <code>slides/&lt;member&gt;/&lt;slug&gt;</code> and
      published here for GitHub Pages. Every entry provides direct links to the
      HTML presentation along with the PDF and PPTX exports published by
      the build pipeline.
    </p>
${deckListMarkup}
  </body>
</html>`;

  await ensureDir(path.dirname(indexPath));
  await fs.writeFile(indexPath, `${html}\n`);
}

async function main() {
  await ensureChromiumDependencies();
  await ensureNoJekyll();
  const conversions = [
    { label: 'HTML', args: [] },
    { label: 'PDF', args: ['--pdf', '--no-html'] },
    { label: 'PPTX', args: ['--pptx', '--no-html'] },
  ];

  for (const conversion of conversions) {
    console.log(`Running Marp for ${conversion.label} output...`);
    await runMarp(conversion.args);
  }
  await copyAssets(INPUT_DIR, OUTPUT_DIR);

  const decksByMember = await collectDecks();
  await writeIndex(decksByMember);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
