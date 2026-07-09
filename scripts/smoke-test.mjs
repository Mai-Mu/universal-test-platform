import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const rootFilesToCheck = [
  'server.js',
  'public/app.js',
  'mcp-server.mjs'
];

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function runNodeCheck(file) {
  const child = spawn(process.execPath, ['--check', file], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`Syntax check failed for ${file}`);
  }
}

async function waitForJson(url, attempts = 40) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`HTTP ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

const filesToCheck = [
  ...rootFilesToCheck,
  ...await collectJsFiles(path.join('public', 'js'))
];

for (const file of filesToCheck) {
  await runNodeCheck(file);
}

const port = String(31000 + Math.floor(Math.random() * 1000));
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: port },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
server.stdout.on('data', chunk => {
  stdout += chunk.toString();
});
server.stderr.on('data', chunk => {
  stderr += chunk.toString();
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const projects = await waitForJson(`${baseUrl}/api/projects`);
  const cases = await waitForJson(`${baseUrl}/api/testcases?projectId=1`);
  const folders = await waitForJson(`${baseUrl}/api/folders?projectId=1`);
  const invalidRestore = await fetch(`${baseUrl}/api/backups/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'nested\\backup.db' })
  });

  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('Expected at least one project from /api/projects');
  }
  if (!Array.isArray(cases)) {
    throw new Error('Expected an array from /api/testcases');
  }
  if (!Array.isArray(folders)) {
    throw new Error('Expected an array from /api/folders');
  }
  if (invalidRestore.status !== 400) {
    throw new Error('Expected invalid backup filename to return HTTP 400');
  }

  console.log(`Smoke test passed on port ${port}: ${projects.length} projects, ${cases.length} project-1 cases.`);
} catch (error) {
  console.error(stdout.trim());
  console.error(stderr.trim());
  throw error;
} finally {
  if (!server.killed) {
    server.kill();
  }
}
