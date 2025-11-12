#!/usr/bin/env node
const { spawn } = require('child_process');
const { promises: fs } = require('fs');
const path = require('path');

const INPUT_DIR = 'slides';
const OUTPUT_DIR = 'docs';

async function runMarp() {
  await new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const marp = spawn(command, ['marp', '--config', 'marp.config.js'], {
      stdio: 'inherit',
    });

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
  await runMarp();
  await copyAssets(INPUT_DIR, OUTPUT_DIR);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
