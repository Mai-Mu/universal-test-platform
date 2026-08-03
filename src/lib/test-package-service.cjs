const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MODES = new Set(['create', 'append', 'upsert']);
const MAX_CASES_PER_IMPORT = 2000;

function listProjects(db) {
  return db.prepare(`
    SELECT p.id, p.name, p.description, p.created_at AS createdAt,
           COUNT(DISTINCT tc.id) AS caseCount,
           COUNT(DISTINCT mf.module_id) AS moduleCount
    FROM projects p
    LEFT JOIN test_cases tc ON tc.project_id = p.id
    LEFT JOIN module_folders mf ON mf.project_id = p.id
    GROUP BY p.id
    ORDER BY p.id
  `).all();
}

function getProject(db, selector) {
  const project = resolveProject(db, selector);
  if (!project) return null;

  const documents = db.prepare(`
    SELECT title, content, sort_order AS sortOrder
    FROM project_documents WHERE project_id = ? ORDER BY sort_order, id
  `).all(project.id);
  const rows = db.prepare(`
    SELECT tc.id, tc.module_id AS moduleId, tc.module_name AS moduleName,
           tc.bg_info AS background, tc.title, tc.precondition, tc.steps,
           tc.expected, tc.status, tc.notes, tc.sort_order AS sortOrder,
           mf.folder_name AS folderName, mf.sort_order AS moduleSortOrder
    FROM test_cases tc
    LEFT JOIN module_folders mf
      ON mf.project_id = tc.project_id AND mf.module_id = tc.module_id
    WHERE tc.project_id = ?
    ORDER BY mf.sort_order, tc.module_id, tc.sort_order, tc.id
  `).all(project.id);

  const folders = [];
  const folderMap = new Map();
  for (const row of rows) {
    const folderName = row.folderName || '未分类';
    if (!folderMap.has(folderName)) {
      const folder = { name: folderName, modules: [] };
      folderMap.set(folderName, folder);
      folders.push(folder);
    }
    const folder = folderMap.get(folderName);
    let module = folder.modules.find(item => item.moduleId === row.moduleId);
    if (!module) {
      module = { moduleId: row.moduleId, name: row.moduleName, background: row.background || '', cases: [] };
      folder.modules.push(module);
    }
    module.cases.push({
      id: row.id,
      title: row.title,
      precondition: row.precondition || '',
      steps: pairSteps(row.steps, row.expected),
      status: row.status,
      notes: row.notes || ''
    });
  }

  return { project, documents, folders };
}

function validatePackage(db, input) {
  const mode = input?.mode;
  const pkg = input?.package;
  const errors = [];
  const warnings = [];

  if (!MODES.has(mode)) errors.push('mode 必须是 create、append 或 upsert');
  if (!pkg || typeof pkg !== 'object') errors.push('package 必须是对象');
  if (errors.length) return validationResult(mode, null, [], errors, warnings);

  const projectName = cleanText(pkg.project?.name);
  const projectId = positiveInteger(pkg.project?.id);
  if (!projectName && !projectId) errors.push('project.name 或 project.id 至少需要一个');
  if (mode === 'create' && !projectName) errors.push('create 模式必须提供 project.name');
  const existingProject = resolveProject(db, { projectId, projectName });
  if (mode === 'create' && existingProject) errors.push(`项目“${existingProject.name}”已存在，create 模式不会覆盖`);
  if (mode !== 'create' && !existingProject) errors.push('append/upsert 模式要求目标项目已经存在');
  if (existingProject && projectName && existingProject.name !== projectName) {
    errors.push(`project.id 与 project.name 指向的项目不一致：实际为“${existingProject.name}”`);
  }

  const normalized = normalizePackage(pkg, errors, warnings);
  if (normalized.caseCount > MAX_CASES_PER_IMPORT) {
    errors.push(`单次最多导入 ${MAX_CASES_PER_IMPORT} 条用例，当前为 ${normalized.caseCount} 条`);
  }

  const ids = new Set();
  for (const item of normalized.cases) {
    if (ids.has(item.id)) errors.push(`导入包内用例编号重复：${item.id}`);
    ids.add(item.id);
  }

  const targetProjectId = existingProject?.id;
  const existingIds = targetProjectId
    ? new Set(db.prepare('SELECT id FROM test_cases WHERE project_id = ?').all(targetProjectId).map(row => row.id))
    : new Set();
  const conflicts = normalized.cases.filter(item => existingIds.has(item.id)).map(item => item.id);
  if (mode === 'append' && conflicts.length) {
    errors.push(`append 模式发现 ${conflicts.length} 个已存在编号：${conflicts.slice(0, 10).join(', ')}`);
  }

  if (normalized.documents.length === 0) warnings.push('导入包没有项目说明章节');
  if (normalized.caseCount === 0) warnings.push('导入包没有测试用例');
  const missingPreconditions = normalized.cases.filter(item => !item.precondition).length;
  if (missingPreconditions) warnings.push(`${missingPreconditions} 条用例没有前置条件`);

  return validationResult(mode, existingProject, conflicts, errors, warnings, normalized);
}

function importPackage(db, input, options = {}) {
  const validation = validatePackage(db, input);
  if (!validation.valid) return { ...validation, imported: false };

  const normalized = validation.normalized;
  const mode = input.mode;
  const source = cleanText(input.source) || 'Codex MCP';
  const packageHash = crypto.createHash('sha256').update(stableStringify(input.package)).digest('hex');
  const projectLabel = normalized.project.name || validation.project?.name || `project-${normalized.project.id}`;
  const backupFilename = createDatabaseBackup(db, options.dbPath, options.backupDir);
  const batchInfo = db.prepare(`
    INSERT INTO import_batches
      (project_id, project_name, mode, source, status, package_hash, backup_filename)
    VALUES (?, ?, ?, ?, 'running', ?, ?)
  `).run(validation.project?.id || null, projectLabel, mode, source, packageHash, backupFilename);
  const batchId = Number(batchInfo.lastInsertRowid);

  try {
    db.exec('BEGIN IMMEDIATE');
    let project = validation.project;
    if (mode === 'create') {
      const result = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)')
        .run(normalized.project.name, normalized.project.description);
      project = { id: Number(result.lastInsertRowid), name: normalized.project.name };
    } else if (normalized.project.description) {
      db.prepare('UPDATE projects SET description = ? WHERE id = ?')
        .run(normalized.project.description, project.id);
    }

    if (normalized.documents.length > 0) {
      if (mode === 'upsert' || mode === 'create') {
        db.prepare('DELETE FROM project_documents WHERE project_id = ?').run(project.id);
      }
      const insertDocument = db.prepare(`
        INSERT INTO project_documents (project_id, title, content, sort_order)
        VALUES (?, ?, ?, ?)
      `);
      const existingDocumentCount = mode === 'append'
        ? db.prepare('SELECT COUNT(*) AS count FROM project_documents WHERE project_id = ?').get(project.id).count
        : 0;
      normalized.documents.forEach((document, index) => {
        insertDocument.run(project.id, document.title, document.content, existingDocumentCount + index);
      });
    }

    const moduleIds = loadModuleIds(db, project.id);
    let nextModuleId = db.prepare('SELECT COALESCE(MAX(module_id), 0) + 1 AS id FROM module_folders').get().id;
    const insertFolder = db.prepare('INSERT OR IGNORE INTO folders (project_id, name, sort_order) VALUES (?, ?, ?)');
    const upsertModule = db.prepare(`
      INSERT INTO module_folders (module_id, project_id, folder_name, sort_order)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET
        project_id = excluded.project_id,
        folder_name = excluded.folder_name,
        sort_order = excluded.sort_order
    `);
    const insertCase = db.prepare(`
      INSERT INTO test_cases
        (project_id, id, module_id, module_name, bg_info, title, precondition,
         steps, expected, status, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', '', ?)
    `);
    const updateCase = db.prepare(`
      UPDATE test_cases SET module_id = ?, module_name = ?, bg_info = ?, title = ?,
        precondition = ?, steps = ?, expected = ?, sort_order = ?
      WHERE project_id = ? AND id = ?
    `);

    let insertedCases = 0;
    let updatedCases = 0;
    for (const [folderIndex, folder] of normalized.folders.entries()) {
      insertFolder.run(project.id, folder.name, folderIndex);
      for (const module of folder.modules) {
        const moduleKey = module.name.toLocaleLowerCase();
        let moduleId = moduleIds.get(moduleKey);
        if (!moduleId) {
          moduleId = nextModuleId;
          nextModuleId += 1;
          moduleIds.set(moduleKey, moduleId);
        }
        upsertModule.run(moduleId, project.id, folder.name, module.sortOrder);

        for (const testCase of module.cases) {
          const steps = testCase.steps.map((step, index) => `${index + 1}. ${step.action}`);
          const expected = testCase.steps.map((step, index) => `${index + 1}. ${step.expected}`);
          const exists = db.prepare('SELECT 1 FROM test_cases WHERE project_id = ? AND id = ?')
            .get(project.id, testCase.id);
          if (exists) {
            updateCase.run(moduleId, module.name, module.background, testCase.title,
              testCase.precondition, JSON.stringify(steps), JSON.stringify(expected),
              testCase.sortOrder, project.id, testCase.id);
            updatedCases += 1;
          } else {
            insertCase.run(project.id, testCase.id, moduleId, module.name, module.background,
              testCase.title, testCase.precondition, JSON.stringify(steps), JSON.stringify(expected),
              testCase.sortOrder);
            insertedCases += 1;
          }
        }
      }
    }

    const summary = {
      projectId: project.id,
      projectName: project.name,
      mode,
      documents: normalized.documents.length,
      folders: normalized.folders.length,
      modules: normalized.moduleCount,
      insertedCases,
      updatedCases,
      preservedExecutionData: mode === 'upsert'
    };
    db.prepare(`
      UPDATE import_batches SET project_id = ?, status = 'completed', summary_json = ?,
        completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(project.id, JSON.stringify(summary), batchId);
    db.exec('COMMIT');
    return { imported: true, batchId, backupFilename, summary, warnings: validation.warnings };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) {}
    db.prepare(`
      UPDATE import_batches SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(error.message, batchId);
    return { imported: false, batchId, backupFilename, error: error.message };
  }
}

function getImportResult(db, batchId) {
  const row = db.prepare(`
    SELECT id AS batchId, project_id AS projectId, project_name AS projectName,
           mode, source, status, package_hash AS packageHash,
           backup_filename AS backupFilename, summary_json AS summary,
           error_message AS error, created_at AS createdAt, completed_at AS completedAt
    FROM import_batches WHERE id = ?
  `).get(batchId);
  if (!row) return null;
  row.summary = JSON.parse(row.summary || '{}');
  return row;
}

function normalizePackage(pkg, errors, warnings) {
  const normalized = {
    project: {
      id: positiveInteger(pkg.project?.id),
      name: cleanText(pkg.project?.name),
      description: cleanText(pkg.project?.description)
    },
    documents: [],
    folders: [],
    cases: [],
    caseCount: 0,
    moduleCount: 0
  };

  const documentTitles = new Set();
  for (const [index, document] of arrayValue(pkg.documents).entries()) {
    const title = cleanText(document?.title);
    if (!title) { errors.push(`documents[${index}].title 不能为空`); continue; }
    const key = title.toLocaleLowerCase();
    if (documentTitles.has(key)) errors.push(`项目说明标题重复：${title}`);
    documentTitles.add(key);
    normalized.documents.push({ title, content: cleanText(document?.content), sortOrder: index });
  }

  const folderNames = new Set();
  const moduleNames = new Set();
  for (const [folderIndex, folder] of arrayValue(pkg.folders).entries()) {
    const folderName = cleanText(folder?.name);
    if (!folderName) { errors.push(`folders[${folderIndex}].name 不能为空`); continue; }
    const folderKey = folderName.toLocaleLowerCase();
    if (folderNames.has(folderKey)) errors.push(`目录名称重复：${folderName}`);
    folderNames.add(folderKey);
    const normalizedFolder = { name: folderName, modules: [] };

    for (const [moduleIndex, module] of arrayValue(folder?.modules).entries()) {
      const moduleName = cleanText(module?.name);
      if (!moduleName) { errors.push(`${folderName} 的第 ${moduleIndex + 1} 个模块名称为空`); continue; }
      const moduleKey = moduleName.toLocaleLowerCase();
      if (moduleNames.has(moduleKey)) errors.push(`模块名称在导入包内重复：${moduleName}`);
      moduleNames.add(moduleKey);
      const normalizedModule = {
        name: moduleName,
        background: cleanText(module?.background),
        sortOrder: normalized.moduleCount,
        cases: []
      };
      normalized.moduleCount += 1;

      for (const [caseIndex, testCase] of arrayValue(module?.cases).entries()) {
        const location = `${folderName}/${moduleName}/cases[${caseIndex}]`;
        const id = cleanText(testCase?.id || testCase?.externalId);
        const title = cleanText(testCase?.title);
        if (!id) errors.push(`${location}.id 不能为空`);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/.test(id)) errors.push(`${location}.id 格式无效：${id}`);
        if (!title) errors.push(`${location}.title 不能为空`);
        const steps = arrayValue(testCase?.steps).map((step, stepIndex) => {
          const action = cleanText(step?.action);
          const expected = cleanText(step?.expected);
          if (!action) errors.push(`${location}.steps[${stepIndex}].action 不能为空`);
          if (!expected) errors.push(`${location}.steps[${stepIndex}].expected 不能为空`);
          return { action, expected };
        });
        if (steps.length === 0) errors.push(`${location}.steps 至少需要一步`);
        const normalizedCase = {
          id,
          title,
          precondition: cleanText(testCase?.precondition),
          steps,
          sortOrder: caseIndex
        };
        normalizedModule.cases.push(normalizedCase);
        normalized.cases.push(normalizedCase);
      }
      normalizedFolder.modules.push(normalizedModule);
    }
    normalized.folders.push(normalizedFolder);
  }
  normalized.caseCount = normalized.cases.length;
  return normalized;
}

function validationResult(mode, project, conflicts, errors, warnings, normalized = null) {
  return {
    valid: errors.length === 0,
    mode,
    project: project ? { id: project.id, name: project.name } : null,
    summary: normalized ? {
      documents: normalized.documents.length,
      folders: normalized.folders.length,
      modules: normalized.moduleCount,
      cases: normalized.caseCount,
      existingCaseConflicts: conflicts.length
    } : null,
    conflicts,
    errors,
    warnings,
    normalized
  };
}

function resolveProject(db, selector = {}) {
  const projectId = positiveInteger(selector.projectId ?? selector.id);
  const projectName = cleanText(selector.projectName ?? selector.name);
  if (projectId) return db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) || null;
  if (projectName) return db.prepare('SELECT * FROM projects WHERE name = ?').get(projectName) || null;
  return null;
}

function loadModuleIds(db, projectId) {
  return new Map(db.prepare(`
    SELECT module_id AS moduleId, MIN(module_name) AS moduleName
    FROM test_cases WHERE project_id = ? GROUP BY module_id
  `).all(projectId).map(row => [row.moduleName.toLocaleLowerCase(), row.moduleId]));
}

function pairSteps(stepsJson, expectedJson) {
  const steps = JSON.parse(stepsJson || '[]');
  const expected = JSON.parse(expectedJson || '[]');
  return steps.map((action, index) => ({
    action: String(action).replace(/^\d+\.\s*/, ''),
    expected: String(expected[index] || '').replace(/^\d+\.\s*/, '')
  }));
}

function createDatabaseBackup(db, dbPath, backupDir) {
  if (!dbPath || !backupDir) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').replace(/\.\d{3}Z$/, '');
  const filename = `test_platform_backup_${timestamp}_mcp_import.db`;
  let finalFilename = filename;
  let destination = path.join(backupDir, finalFilename);
  let sequence = 2;
  while (fs.existsSync(destination)) {
    finalFilename = `test_platform_backup_${timestamp}_${sequence}_mcp_import.db`;
    destination = path.join(backupDir, finalFilename);
    sequence += 1;
  }
  const escaped = destination.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return finalFilename;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function arrayValue(value) { return Array.isArray(value) ? value : []; }
function cleanText(value) { return typeof value === 'string' ? value.trim() : ''; }
function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

module.exports = {
  getImportResult,
  getProject,
  importPackage,
  listProjects,
  validatePackage
};
