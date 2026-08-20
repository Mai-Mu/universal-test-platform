const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { ensurePlatformSchema } = require('./lib/platform-db.cjs');

const app = express();
const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.TEST_PLATFORM_DATA_DIR || path.join(PROJECT_ROOT, 'data'));
const DB_PATH = path.join(DATA_DIR, 'testcases.db');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Enable JSON middleware
app.use(express.json());

// Initialize SQLite database
let db = new DatabaseSync(DB_PATH);

function closeDb() {
  if (db) db.close();
}

function reopenDb() {
  db = new DatabaseSync(DB_PATH);
  ensurePlatformSchema(db);
}

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON');
ensurePlatformSchema(db);

// Add projects table
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Project-level notes imported alongside test cases, kept as ordered Markdown sections.
db.exec(`
  CREATE TABLE IF NOT EXISTS project_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_project_documents_project_order ON project_documents(project_id, sort_order, id)');

// Add default project
try {
  const projCount = db.prepare("SELECT COUNT(*) as count FROM projects").get().count;
  if (projCount === 0) {
    db.prepare("INSERT INTO projects (id, name, description) VALUES (?, ?, ?)").run(1, '默认测试项目', '用于快速体验平台能力的初始项目');
    console.log("Database migrated: Default project created.");
  }
} catch (err) {
  console.error("Failed to seed default project: ", err);
}

// Create test cases table
db.exec(`
  CREATE TABLE IF NOT EXISTS test_cases (
    project_id INTEGER NOT NULL DEFAULT 1,
    id TEXT NOT NULL,
    module_id INTEGER NOT NULL,
    module_name TEXT NOT NULL,
    bg_info TEXT,
    title TEXT NOT NULL,
    precondition TEXT,
    steps TEXT NOT NULL,      -- Stored as JSON stringified array
    expected TEXT NOT NULL,   -- Stored as JSON stringified array
    status TEXT DEFAULT 'untested',
    notes TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  )
`);

// Alter test_cases for missing columns (migration)
const addColumnIfMissing = (table, col, def) => {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some(c => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} INTEGER DEFAULT ${def}`);
      db.exec(`UPDATE ${table} SET ${col} = ${def} WHERE ${col} IS NULL`);
      console.log(`Database migrated: Added '${col}' column to '${table}' table.`);
    }
  } catch (err) {
    console.error(`Failed to add ${col} to ${table}: `, err);
  }
};
addColumnIfMissing('test_cases', 'sort_order', '0');
addColumnIfMissing('test_cases', 'project_id', '1');

// Create folders table
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    project_id INTEGER DEFAULT 1,
    name TEXT,
    sort_order INTEGER DEFAULT 0,
    PRIMARY KEY (project_id, name)
  )
`);

// Migrate folders
try {
  const info = db.prepare("PRAGMA table_info(folders)").all();
  if (!info.some(c => c.name === 'project_id')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS folders_new (
        project_id INTEGER DEFAULT 1,
        name TEXT,
        sort_order INTEGER DEFAULT 0,
        PRIMARY KEY (project_id, name)
      )
    `);
    db.exec(`INSERT INTO folders_new (project_id, name, sort_order) SELECT 1, name, sort_order FROM folders`);
    db.exec(`DROP TABLE folders`);
    db.exec(`ALTER TABLE folders_new RENAME TO folders`);
    console.log("Database migrated: 'folders' table now has project_id PK.");
  }
} catch (e) {
  console.error("Failed to migrate folders: ", e);
}

// Create module_folders table
db.exec(`
  CREATE TABLE IF NOT EXISTS module_folders (
    module_id INTEGER PRIMARY KEY,
    project_id INTEGER DEFAULT 1,
    folder_name TEXT,
    sort_order INTEGER DEFAULT 0,
    FOREIGN KEY(project_id, folder_name) REFERENCES folders(project_id, name) ON DELETE SET NULL
  )
`);

// Migrate module_folders
try {
  const info = db.prepare("PRAGMA table_info(module_folders)").all();
  if (!info.some(c => c.name === 'project_id')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS module_folders_new (
        module_id INTEGER PRIMARY KEY,
        project_id INTEGER DEFAULT 1,
        folder_name TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY(project_id, folder_name) REFERENCES folders(project_id, name) ON DELETE SET NULL
      )
    `);
    db.exec(`INSERT INTO module_folders_new (module_id, project_id, folder_name, sort_order) SELECT module_id, 1, folder_name, sort_order FROM module_folders`);
    db.exec(`DROP TABLE module_folders`);
    db.exec(`ALTER TABLE module_folders_new RENAME TO module_folders`);
    console.log("Database migrated: 'module_folders' table now has project_id.");
  }
} catch (e) {
  console.error("Failed to migrate module_folders: ", e);
}

// Seed data definition
const seedCases = [
  {
    moduleId: 1,
    moduleName: "1. ???????",
    bgInfo: "????????????????????????",
    cases: [
      {
        id: "TC-01-01",
        title: "???? - ????????",
        precondition: "?????????????????????",
        steps: [
          "1. ????????",
          "2. ???????????",
          "3. ???????"
        ],
        expected: [
          "1. ??????????????",
          "2. ????????????????",
          "3. ???????????"
        ]
      },
      {
        id: "TC-01-02",
        title: "???? - ????????",
        precondition: "?????????????????",
        steps: [
          "1. ????????",
          "2. ????????????",
          "3. ???????"
        ],
        expected: [
          "1. ???????",
          "2. ?????????????????",
          "3. ??????????????????????"
        ]
      },
      {
        id: "TC-01-03",
        title: "???? - ?????????????",
        precondition: "????????????????",
        steps: [
          "1. ????????????",
          "2. ??????? URL ???????"
        ],
        expected: [
          "1. ???????????",
          "2. ?????????????????????",
          "3. ?????????????"
        ]
      }
    ]
  },
  {
    moduleId: 2,
    moduleName: "2. ???????",
    bgInfo: "?????????????????????????",
    cases: [
      {
        id: "TC-02-01",
        title: "???? - ??????????",
        precondition: "???????????????",
        steps: [
          "1. ????????",
          "2. ????????????????????",
          "3. ???????"
        ],
        expected: [
          "1. ????????????????",
          "2. ?????????????",
          "3. ??????????????"
        ]
      },
      {
        id: "TC-02-02",
        title: "??? - ????????????",
        precondition: "???????????????",
        steps: [
          "1. ????????",
          "2. ??????????",
          "3. ???????"
        ],
        expected: [
          "1. ????????????",
          "2. ?????????????????",
          "3. ??????????????"
        ]
      }
    ]
  },
  {
    moduleId: 3,
    moduleName: "3. ???????",
    bgInfo: "??????????????????????",
    cases: [
      {
        id: "TC-03-01",
        title: "???? - ???? CSV ??",
        precondition: "???????????????",
        steps: [
          "1. ???????",
          "2. ???? CSV ???",
          "3. ???????????"
        ],
        expected: [
          "1. ??????? CSV ???",
          "2. ???????????????????????????",
          "3. ?????????????????"
        ]
      },
      {
        id: "TC-03-02",
        title: "???? - ?????????",
        precondition: "???????????????",
        steps: [
          "1. ?????????",
          "2. ?????????",
          "3. ???????"
        ],
        expected: [
          "1. ???????????",
          "2. ????????????????",
          "3. ????????????????"
        ]
      }
    ]
  }
];

// Helper to seed database if empty
function seedDatabase() {
  const countQuery = db.prepare('SELECT COUNT(*) AS cnt FROM test_cases');
  const result = countQuery.get();
  
  if (result.cnt === 0) {
    console.log('Database empty. Seeding initial test cases...');
    const insertStmt = db.prepare(`
      INSERT INTO test_cases (id, module_id, module_name, bg_info, title, precondition, steps, expected, status, notes, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    seedCases.forEach(module => {
      module.cases.forEach((c, index) => {
        insertStmt.run(
          c.id,
          module.moduleId,
          module.moduleName,
          module.bgInfo,
          c.title,
          c.precondition,
          JSON.stringify(c.steps),
          JSON.stringify(c.expected),
          'untested',
          '',
          index
        );
      });
    });
    console.log(`Successfully seeded ${seedCases.reduce((acc, m) => acc + m.cases.length, 0)} test cases.`);
  } else {
    console.log('Database already initialized.');
  }
}

// Seed the DB
seedDatabase();

// --- API Endpoints ---

// --- Projects Endpoints ---
app.get('/api/projects', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_at,
        COUNT(tc.id) AS caseCount,
        COALESCE(SUM(CASE WHEN tc.status = 'passed' THEN 1 ELSE 0 END), 0) AS passedCount,
        COALESCE(SUM(CASE WHEN tc.status = 'failed' THEN 1 ELSE 0 END), 0) AS failedCount,
        COALESCE(SUM(CASE WHEN tc.status = 'blocked' THEN 1 ELSE 0 END), 0) AS blockedCount,
        COALESCE(SUM(CASE WHEN tc.status = 'untested' THEN 1 ELSE 0 END), 0) AS untestedCount
      FROM projects p
      LEFT JOIN test_cases tc ON tc.project_id = p.id
      GROUP BY p.id
      ORDER BY p.id ASC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve projects' });
  }
});

app.put('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  try {
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
    res.json({ success: true, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

app.post('/api/projects', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  try {
    const stmt = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)');
    const info = stmt.run(name, description || '');
    res.json({ success: true, id: info.lastInsertRowid, name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.get('/api/project-documents', (req, res) => {
  const projectId = Number(req.query.projectId || 1);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'A valid projectId is required' });
  }

  try {
    const rows = db.prepare(`
      SELECT id, project_id AS projectId, title, content, sort_order AS sortOrder,
             created_at AS createdAt, updated_at AS updatedAt
      FROM project_documents
      WHERE project_id = ?
      ORDER BY sort_order, id
    `).all(projectId);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve project documents' });
  }
});

app.put('/api/project-documents', (req, res) => {
  const projectId = Number(req.body.projectId);
  const sections = req.body.sections;
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Array.isArray(sections)) {
    return res.status(400).json({ error: 'A valid projectId and sections array are required' });
  }

  const normalized = sections.map((section, index) => ({
    title: String(section?.title || '').trim(),
    content: String(section?.content || '').trim(),
    sortOrder: Number.isSafeInteger(section?.sortOrder) ? section.sortOrder : index
  }));
  if (normalized.some(section => !section.title)) {
    return res.status(400).json({ error: 'Every document section requires a title' });
  }

  try {
    if (!db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    db.exec('BEGIN IMMEDIATE');
    db.prepare('DELETE FROM project_documents WHERE project_id = ?').run(projectId);
    const insert = db.prepare(`
      INSERT INTO project_documents (project_id, title, content, sort_order)
      VALUES (?, ?, ?, ?)
    `);
    normalized.forEach(section => insert.run(projectId, section.title, section.content, section.sortOrder));
    db.exec('COMMIT');
    res.json({ success: true, count: normalized.length });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) {}
    console.error(err);
    res.status(500).json({ error: 'Failed to update project documents' });
  }
});

// 1. Get all test cases (with folder association)
app.get('/api/testcases', (req, res) => {
  const projectId = req.query.projectId || 1;
  try {
    const query = db.prepare(`
      SELECT tc.*, mf.folder_name, mf.sort_order AS module_sort_order
      FROM test_cases tc
      LEFT JOIN module_folders mf ON tc.module_id = mf.module_id AND mf.project_id = tc.project_id
      WHERE tc.project_id = ?
      ORDER BY tc.module_id, tc.sort_order, tc.id
    `);
    const rows = query.all(projectId);
    
    // Parse JSON strings back to arrays
    const formatted = rows.map(row => ({
      id: row.id,
      moduleId: row.module_id,
      moduleName: row.module_name,
      bgInfo: row.bg_info,
      title: row.title,
      precondition: row.precondition,
      steps: JSON.parse(row.steps),
      expected: JSON.parse(row.expected),
      status: row.status,
      notes: row.notes,
      folderName: row.folder_name,
      sortOrder: row.sort_order,
      moduleSortOrder: row.module_sort_order || 0
    }));
    
    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve test cases' });
  }
});

// 2. Update test case status
app.post('/api/testcases/status', (req, res) => {
  const { id, status, projectId = 1 } = req.body;
  if (!id || !status) {
    return res.status(400).json({ error: 'Missing required parameters: id and status' });
  }
  
  try {
    const stmt = db.prepare('UPDATE test_cases SET status = ? WHERE project_id = ? AND id = ?');
    const result = stmt.run(status, projectId, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: `Test case with ID ${id} not found` });
    }
    
    res.json({ success: true, id, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// 3. Update test case notes
app.post('/api/testcases/notes', (req, res) => {
  const { id, notes, projectId = 1 } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing required parameter: id' });
  }
  
  try {
    const stmt = db.prepare('UPDATE test_cases SET notes = ? WHERE project_id = ? AND id = ?');
    const result = stmt.run(notes || '', projectId, id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: `Test case with ID ${id} not found` });
    }
    
    res.json({ success: true, id, notes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// 4. Reset all test cases
app.post('/api/testcases/reset', (req, res) => {
  const projectId = req.body.projectId || 1;
  const moduleId = req.body.moduleId;
  try {
    if (moduleId) {
      db.prepare("UPDATE test_cases SET status = 'untested', notes = '', sort_order = 0 WHERE project_id = ? AND module_id = ?").run(projectId, moduleId);
      res.json({ success: true, message: 'Module test case states have been reset.' });
    } else {
      // Reset ALL
      db.prepare("UPDATE test_cases SET status = 'untested', notes = '', sort_order = 0 WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM module_folders WHERE project_id = ?").run(projectId);
      db.prepare("DELETE FROM folders WHERE project_id = ?").run(projectId);
      res.json({ success: true, message: 'All test case states and folder mappings have been reset for project.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reset test cases' });
  }
});

// 4.5. Reorder test cases within a module
app.post('/api/testcases/reorder', (req, res) => {
  const { ids, projectId = 1 } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Missing required parameter: ids (array)' });
  }
  
  try {
    const stmt = db.prepare('UPDATE test_cases SET sort_order = ? WHERE project_id = ? AND id = ?');
    ids.forEach((id, index) => {
      stmt.run(index, projectId, id);
    });
    res.json({ success: true, message: 'Test cases reordered successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder test cases' });
  }
});

// 5. Get all folders
app.get('/api/folders', (req, res) => {
  const projectId = req.query.projectId || 1;
  try {
    const rows = db.prepare('SELECT name FROM folders WHERE project_id = ? ORDER BY sort_order, name').all(projectId);
    res.json(rows.map(r => r.name));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to retrieve folders' });
  }
});

// 5.5. Reorder folders
app.post('/api/folders/reorder', (req, res) => {
  const { names, projectId = 1 } = req.body;
  if (!names || !Array.isArray(names)) {
    return res.status(400).json({ error: 'Missing required parameter: names (array)' });
  }
  
  try {
    const stmt = db.prepare('UPDATE folders SET sort_order = ? WHERE project_id = ? AND name = ?');
    names.forEach((name, index) => {
      stmt.run(index, projectId, name);
    });
    res.json({ success: true, message: 'Folders reordered successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder folders' });
  }
});

// 6. Create a folder
app.post('/api/folders', (req, res) => {
  const { name, projectId = 1 } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  const cleanName = name.trim();
  try {
    const stmt = db.prepare('INSERT OR IGNORE INTO folders (project_id, name) VALUES (?, ?)');
    stmt.run(projectId, cleanName);
    res.json({ success: true, name: cleanName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// 7. Delete a folder
app.delete('/api/folders', (req, res) => {
  const { name, projectId = 1 } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Folder name is required' });
  }
  try {
    const stmt = db.prepare('DELETE FROM folders WHERE project_id = ? AND name = ?');
    stmt.run(projectId, name);
    res.json({ success: true, message: `Folder ${name} deleted.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// 8. Move a module to a folder
app.post('/api/modules/folder', (req, res) => {
  const { moduleId, folderName, projectId = 1 } = req.body;
  if (moduleId === undefined) {
    return res.status(400).json({ error: 'Module ID is required' });
  }
  try {
    const folder = (folderName === null || folderName === '') ? null : folderName;
    const stmt = db.prepare(`
      INSERT INTO module_folders (module_id, project_id, folder_name) 
      VALUES (?, ?, ?) 
      ON CONFLICT(module_id) DO UPDATE SET folder_name = excluded.folder_name, project_id = excluded.project_id
    `);
    stmt.run(moduleId, projectId, folder);
    res.json({ success: true, moduleId, folderName: folder });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to associate module to folder' });
  }
});

// 9. Reorder modules
app.post('/api/modules/reorder', (req, res) => {
  const { moduleIds, projectId = 1 } = req.body;
  if (!moduleIds || !Array.isArray(moduleIds)) {
    return res.status(400).json({ error: 'Missing required parameter: moduleIds (array)' });
  }
  
  try {
    const stmt = db.prepare(`
      INSERT INTO module_folders (module_id, project_id, folder_name, sort_order) 
      VALUES (?, ?, NULL, ?) 
      ON CONFLICT(module_id) DO UPDATE SET sort_order = excluded.sort_order, project_id = excluded.project_id
    `);
    moduleIds.forEach((id, index) => {
      stmt.run(id, projectId, index);
    });
    res.json({ success: true, message: 'Modules reordered successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reorder modules' });
  }
});

// --- Backup & Restore System ---

const BACKUP_DIR = process.env.TEST_PLATFORM_BACKUP_DIR || process.env.BACKUP_DIR
  ? path.resolve(process.env.TEST_PLATFORM_BACKUP_DIR || process.env.BACKUP_DIR)
  : path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function getBackupCreationTime(stats) {
  if (Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0) {
    return stats.birthtime;
  }
  return stats.ctime;
}

function formatLocalBackupTimestamp(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function createBackupFileName(type, now) {
  const baseName = `test_platform_backup_${formatLocalBackupTimestamp(now)}`;
  let fileName = `${baseName}_${type}.db`;
  let sequence = 2;

  while (fs.existsSync(path.join(BACKUP_DIR, fileName))) {
    fileName = `${baseName}_${sequence}_${type}.db`;
    sequence += 1;
  }

  return fileName;
}

function getSafeBackupPath(filename) {
  const file = String(filename || '');
  if (!/^[A-Za-z0-9_.-]+\.db$/.test(file)) {
    return null;
  }

  const backupRoot = path.resolve(BACKUP_DIR);
  const resolvedPath = path.resolve(backupRoot, file);
  if (!resolvedPath.startsWith(backupRoot + path.sep)) {
    return null;
  }

  return resolvedPath;
}

// Perform a backup
function performBackup(type = 'auto') {
  const now = new Date();
  const fileName = createBackupFileName(type, now);
  const destPath = path.join(BACKUP_DIR, fileName);
  
  try {
    fs.copyFileSync(DB_PATH, destPath);
    fs.utimesSync(destPath, now, now);
    console.log(`[Backup] Successfully created ${fileName}`);
    cleanOldBackups();
    return { success: true, fileName };
  } catch (err) {
    console.error(`[Backup] Failed to create backup ${fileName}:`, err);
    return { success: false, error: err.message };
  }
}

// Keep only the last 30 backups
function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => ({
        name: f,
        time: getBackupCreationTime(fs.statSync(path.join(BACKUP_DIR, f))).getTime()
      }))
      .sort((a, b) => b.time - a.time); // newest first

    if (files.length > 30) {
      const toDelete = files.slice(30);
      toDelete.forEach(file => {
        fs.unlinkSync(path.join(BACKUP_DIR, file.name));
        console.log(`[Backup] Deleted old backup: ${file.name}`);
      });
    }
  } catch (err) {
    console.error('[Backup] Failed to clean old backups:', err);
  }
}

function hasAutomaticBackupForDate(date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

  return fs.readdirSync(BACKUP_DIR)
    .filter(file => /_auto\.db$/i.test(file))
    .some(file => {
      const createdAt = getBackupCreationTime(fs.statSync(path.join(BACKUP_DIR, file)));
      return createdAt >= dayStart && createdAt < nextDay;
    });
}

function runDailyAutomaticBackup(reason) {
  const now = new Date();
  if (hasAutomaticBackupForDate(now)) {
    console.log(`[Backup] Daily automatic backup already exists; skipped ${reason} run.`);
    return;
  }

  console.log(`[Backup] Running ${reason} daily backup...`);
  performBackup('auto');
}

// Schedule daily backup at 02:00 in the server's local timezone.
const BACKUP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
cron.schedule('0 2 * * *', () => runDailyAutomaticBackup('scheduled'), {
  timezone: BACKUP_TIMEZONE
});
console.log(`[Backup] Daily backup scheduled for 02:00 (${BACKUP_TIMEZONE}).`);

// If the server was offline at 02:00, create today's backup when it starts later.
if (new Date().getHours() >= 2) {
  runDailyAutomaticBackup('startup catch-up');
}

// GET /api/backups - List backups
app.get('/api/backups', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          name: f,
          size: stats.size,
          createdAt: getBackupCreationTime(stats)
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// POST /api/backups - Trigger manual backup
app.post('/api/backups', (req, res) => {
  const result = performBackup('manual');
  if (result.success) {
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// GET /api/backups/download/:filename
app.get('/api/backups/download/:filename', (req, res) => {
  const file = req.params.filename;
  const filePath = getSafeBackupPath(file);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// DELETE /api/backups/:filename
app.delete('/api/backups/:filename', (req, res) => {
  const file = req.params.filename;
  const filePath = getSafeBackupPath(file);
  if (!filePath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: 'Deleted' });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// POST /api/backups/restore
app.post('/api/backups/restore', (req, res) => {
  const { filename } = req.body;
  const backupPath = getSafeBackupPath(filename);
  if (!backupPath) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  
  if (!fs.existsSync(backupPath)) {
    return res.status(404).json({ error: 'Backup file not found' });
  }

  try {
    // 1. Create a safety snapshot
    console.log('[Restore] Creating safety snapshot before restore...');
    performBackup('safety_pre_restore');
    
    // 2. Smoothly disconnect current DB
    closeDb();
    
    // 3. Overwrite the file
    fs.copyFileSync(backupPath, DB_PATH);
    
    // 4. Reconnect
    reopenDb();
    
    console.log(`[Restore] Successfully restored from ${filename}`);
    res.json({ success: true, message: 'Database restored successfully' });
  } catch (err) {
    console.error('[Restore] Failed to restore:', err);
    // Try to recover connection if something failed midway
    try { reopenDb(); } catch(e) {}
    res.status(500).json({ error: 'Failed to restore database: ' + err.message });
  }
});

// Serve static frontend assets
app.use(express.static(PUBLIC_DIR));

// Default fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`Universal Test Platform running at http://localhost:${PORT}`);
});
