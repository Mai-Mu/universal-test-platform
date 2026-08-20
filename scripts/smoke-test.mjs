import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const rootFilesToCheck = [
  'src/server.js',
  'public/app.js',
  'public/js/router.mjs',
  'public/js/reportBuilder.mjs',
  'src/mcp-server.mjs'
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

const routerUrl = pathToFileURL(path.resolve('public/js/router.mjs')).href;
const { buildAppUrl, parseAppRoute } = await import(routerUrl);
assert.deepEqual(parseAppRoute('/', ''), { page: 'home' });
assert.deepEqual(parseAppRoute('/projects/7', '?module=12'), {
  page: 'project',
  projectId: 7,
  view: 'module',
  moduleId: 12
});
assert.deepEqual(parseAppRoute('/projects/7', '?view=cases&status=failed'), {
  page: 'project',
  projectId: 7,
  view: 'project-cases',
  filter: 'failed'
});
assert.deepEqual(parseAppRoute('/projects/7', '?view=docs'), {
  page: 'project',
  projectId: 7,
  view: 'project-docs'
});
assert.deepEqual(parseAppRoute('/projects/7/backups', ''), {
  page: 'project',
  projectId: 7,
  view: 'backup'
});
assert.equal(buildAppUrl({ page: 'project', projectId: 7, view: 'dashboard' }), '/projects/7');
assert.equal(buildAppUrl({ page: 'project', projectId: 7, view: 'module', moduleId: 12 }), '/projects/7?module=12');
assert.equal(
  buildAppUrl({ page: 'project', projectId: 7, view: 'project-cases', filter: 'failed' }),
  '/projects/7?view=cases&status=failed'
);
assert.equal(buildAppUrl({ page: 'project', projectId: 7, view: 'backup' }), '/projects/7/backups');
assert.equal(buildAppUrl({ page: 'project', projectId: 7, view: 'project-docs' }), '/projects/7?view=docs');

const reportBuilderUrl = pathToFileURL(path.resolve('public/js/reportBuilder.mjs')).href;
const { buildStandaloneReport } = await import(reportBuilderUrl);
const sampleReport = buildStandaloneReport({
  projectName: '<script>alert("unsafe")</script>',
  folderOrder: ['核心功能'],
  generatedAt: new Date('2026-07-13T08:00:00Z'),
  testCases: [
    { id: 'TC-1', moduleId: 1, moduleName: '登录模块', folderName: '核心功能', status: 'passed' },
    { id: 'TC-2', moduleId: 1, moduleName: '登录模块', folderName: '核心功能', status: 'failed' },
    { id: 'TC-3', moduleId: 2, moduleName: '导出模块', folderName: '核心功能', status: 'blocked' }
  ]
});

if (!sampleReport.startsWith('<!DOCTYPE html>')) {
  throw new Error('Expected standalone report to be a complete HTML document');
}
if (!sampleReport.includes('conic-gradient')
  || !sampleReport.includes('模块风险条形图')
  || !sampleReport.includes('项目结构树')) {
  throw new Error('Expected standalone report to contain charts and hierarchy content');
}
if (sampleReport.includes('<script>alert') || !sampleReport.includes('&lt;script&gt;')) {
  throw new Error('Expected standalone report to escape user-provided text');
}
if (/<(?:script|link|img)[^>]+(?:src|href)=["']https?:/i.test(sampleReport)) {
  throw new Error('Expected standalone report to avoid external runtime assets');
}

const port = String(31000 + Math.floor(Math.random() * 1000));
const smokeDataDir = await mkdtemp(path.join(tmpdir(), 'test-platform-web-'));
const smokeBackupDir = path.join(smokeDataDir, 'backups');
const server = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: port,
    TEST_PLATFORM_DATA_DIR: smokeDataDir,
    TEST_PLATFORM_BACKUP_DIR: smokeBackupDir
  },
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
  const projectDocuments = await waitForJson(`${baseUrl}/api/project-documents?projectId=1`);
  const projectPage = await fetch(`${baseUrl}/projects/1`);
  const backupPage = await fetch(`${baseUrl}/projects/1/backups`);
  const projectPageHtml = await projectPage.text();
  const backupPageHtml = await backupPage.text();
  const backupStartedAt = Date.now();
  const backupResponse = await fetch(`${baseUrl}/api/backups`, { method: 'POST' });
  const backupResult = await backupResponse.json();
  const backups = await waitForJson(`${baseUrl}/api/backups`);
  const listedBackup = backups.find(backup => backup.name === backupResult.fileName);
  const invalidRestore = await fetch(`${baseUrl}/api/backups/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: 'nested\\backup.db' })
  });

  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error('Expected at least one project from /api/projects');
  }
  const projectSummaryFields = ['caseCount', 'passedCount', 'failedCount', 'blockedCount', 'untestedCount'];
  if (!projectSummaryFields.every(field => Number.isFinite(projects[0][field]))) {
    throw new Error('Expected /api/projects to include numeric cross-project status summaries');
  }
  if (!Array.isArray(cases)) {
    throw new Error('Expected an array from /api/testcases');
  }
  if (!Array.isArray(folders)) {
    throw new Error('Expected an array from /api/folders');
  }
  if (!Array.isArray(projectDocuments)) {
    throw new Error('Expected an array from /api/project-documents');
  }
  if (!projectPage.ok || !projectPageHtml.includes('id="workspace-view"')) {
    throw new Error('Expected /projects/1 to return the frontend application');
  }
  if (!projectPageHtml.includes('id="home-summary-grid"')
    && !projectPageHtml.includes('class="home-summary-grid"')) {
    throw new Error('Expected the frontend application to contain the home workbench summary');
  }
  if (!backupPage.ok || !backupPageHtml.includes('id="backup-view"')) {
    throw new Error('Expected /projects/1/backups to return the frontend application');
  }
  if (!backupResponse.ok || !backupResult.success) {
    throw new Error('Expected manual backup creation to succeed');
  }
  if (!/^test_platform_backup_\d{4}-\d{2}-\d{2}_\d{6}(?:_\d+)?_manual\.db$/.test(backupResult.fileName)) {
    throw new Error('Expected backup filename to contain a readable local timestamp');
  }
  if (!listedBackup) {
    throw new Error('Expected the new backup to appear in /api/backups');
  }

  const listedCreatedAt = new Date(listedBackup.createdAt).getTime();
  const backupStats = await stat(path.join(smokeBackupDir, backupResult.fileName));
  if (Math.abs(listedCreatedAt - backupStartedAt) > 15000
    || Math.abs(backupStats.mtimeMs - backupStartedAt) > 15000) {
    throw new Error('Expected backup creation timestamps to match the actual creation time');
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
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, 'exit'), delay(2000)]);
  }
  await rm(smokeDataDir, { recursive: true, force: true });
}
