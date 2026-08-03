import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const tempDir = await mkdtemp(path.join(tmpdir(), 'test-platform-mcp-'));
const dbPath = path.join(tempDir, 'test.db');
const backupDir = path.join(tempDir, 'backups');
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE test_cases (
    id TEXT PRIMARY KEY, project_id INTEGER DEFAULT 1, module_id INTEGER NOT NULL,
    module_name TEXT NOT NULL, bg_info TEXT, title TEXT NOT NULL, precondition TEXT,
    steps TEXT NOT NULL, expected TEXT NOT NULL, status TEXT DEFAULT 'untested',
    notes TEXT DEFAULT '', sort_order INTEGER DEFAULT 0
  );
  CREATE TABLE folders (project_id INTEGER DEFAULT 1, name TEXT, sort_order INTEGER DEFAULT 0, PRIMARY KEY(project_id, name));
  CREATE TABLE module_folders (module_id INTEGER PRIMARY KEY, project_id INTEGER DEFAULT 1, folder_name TEXT, sort_order INTEGER DEFAULT 0);
`);
db.close();

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['src/mcp-server.mjs'],
  env: { ...process.env, TEST_PLATFORM_DB: dbPath, TEST_PLATFORM_BACKUP_DIR: backupDir },
  stderr: 'pipe'
});
const client = new Client({ name: 'test-platform-smoke', version: '1.0.0' });

const testPackage = {
  project: { name: 'MCP 回归项目', description: '隔离环境端到端测试' },
  documents: [{ title: '执行说明', content: '先执行主流程。' }],
  folders: [{
    name: 'P0 主流程',
    modules: [{
      name: '登录',
      background: '验证基础登录能力',
      cases: [{
        id: 'TC-P0-001',
        title: '账号密码登录',
        precondition: '账号已启用',
        steps: [{ action: '输入正确账号密码并提交', expected: '登录成功并进入首页' }]
      }]
    }]
  }]
};

try {
  await client.connect(transport);
  const listedTools = await client.listTools();
  assert.deepEqual(listedTools.tools.map(tool => tool.name), [
    'list_test_projects', 'get_test_project', 'validate_test_package',
    'import_test_package', 'get_import_result'
  ]);

  const validate = parse(await client.callTool({
    name: 'validate_test_package', arguments: { mode: 'create', source: 'smoke', package: testPackage }
  }));
  assert.equal(validate.valid, true);
  assert.equal(validate.summary.cases, 1);

  const imported = parse(await client.callTool({
    name: 'import_test_package', arguments: { mode: 'create', source: 'smoke', package: testPackage }
  }));
  assert.equal(imported.imported, true);
  assert.equal(imported.summary.insertedCases, 1);
  assert.ok(imported.backupFilename);

  const duplicate = parse(await client.callTool({
    name: 'validate_test_package',
    arguments: { mode: 'append', source: 'smoke', package: { ...testPackage, project: { name: 'MCP 回归项目' } } }
  }));
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.summary.existingCaseConflicts, 1);

  const targetDb = new DatabaseSync(dbPath);
  targetDb.prepare("UPDATE test_cases SET status = 'passed', notes = '保留执行信息' WHERE project_id = 1 AND id = 'TC-P0-001'").run();
  targetDb.close();
  const updatedPackage = structuredClone(testPackage);
  updatedPackage.project = { name: 'MCP 回归项目' };
  updatedPackage.folders[0].modules[0].cases[0].title = '账号密码登录（更新）';
  const updated = parse(await client.callTool({
    name: 'import_test_package', arguments: { mode: 'upsert', source: 'smoke', package: updatedPackage }
  }));
  assert.equal(updated.imported, true);
  assert.equal(updated.summary.updatedCases, 1);

  const project = parse(await client.callTool({
    name: 'get_test_project', arguments: { projectName: 'MCP 回归项目' }
  }));
  assert.equal(project.folders[0].modules[0].cases[0].title, '账号密码登录（更新）');
  assert.equal(project.folders[0].modules[0].cases[0].status, 'passed');
  assert.equal(project.folders[0].modules[0].cases[0].notes, '保留执行信息');

  const result = parse(await client.callTool({
    name: 'get_import_result', arguments: { batchId: updated.batchId }
  }));
  assert.equal(result.status, 'completed');

  const secondPackage = structuredClone(testPackage);
  secondPackage.project = { name: 'MCP 第二项目', description: '验证项目级编号唯一性' };
  const secondImport = parse(await client.callTool({
    name: 'import_test_package', arguments: { mode: 'create', source: 'smoke', package: secondPackage }
  }));
  assert.equal(secondImport.imported, true);
  assert.equal(secondImport.summary.insertedCases, 1);

  const migratedDb = new DatabaseSync(dbPath);
  const primaryKey = migratedDb.prepare('PRAGMA table_info(test_cases)').all()
    .filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name);
  assert.deepEqual(primaryKey, ['project_id', 'id']);
  assert.equal(migratedDb.prepare("SELECT COUNT(*) AS count FROM test_cases WHERE id = 'TC-P0-001'").get().count, 2);
  assert.equal(migratedDb.prepare('SELECT COUNT(*) AS count FROM import_batches').get().count, 3);
  migratedDb.close();
  console.log('MCP smoke test passed: create, project-scoped IDs, conflict detection, upsert and audit verified.');
} finally {
  await client.close().catch(() => {});
  await rm(tempDir, { recursive: true, force: true });
}

function parse(result) {
  return JSON.parse(result.content.find(item => item.type === 'text').text);
}
