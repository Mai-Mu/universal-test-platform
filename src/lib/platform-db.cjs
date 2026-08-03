function ensurePlatformSchema(db) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_project_documents_project_order
      ON project_documents(project_id, sort_order, id);

    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      project_name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('create', 'append', 'upsert')),
      source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
      package_hash TEXT NOT NULL,
      backup_filename TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_import_batches_project_created
      ON import_batches(project_id, created_at DESC, id DESC);
  `);

  ensureProjectScopedCaseIds(db);
}

function ensureProjectScopedCaseIds(db) {
  const columns = db.prepare('PRAGMA table_info(test_cases)').all();
  if (columns.length === 0) {
    createTestCasesTable(db, 'test_cases');
    return;
  }

  const primaryKeyColumns = columns
    .filter(column => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map(column => column.name);
  if (primaryKeyColumns.join(',') === 'project_id,id') return;

  const hasProjectId = columns.some(column => column.name === 'project_id');
  const projectExpression = hasProjectId ? 'COALESCE(project_id, 1)' : '1';
  db.exec('BEGIN IMMEDIATE');
  try {
    createTestCasesTable(db, 'test_cases_new');
    db.exec(`
      INSERT INTO test_cases_new (
        project_id, id, module_id, module_name, bg_info, title, precondition,
        steps, expected, status, notes, sort_order
      )
      SELECT ${projectExpression}, id, module_id, module_name, bg_info, title,
             precondition, steps, expected, status, notes, COALESCE(sort_order, 0)
      FROM test_cases
    `);
    db.exec('DROP TABLE test_cases');
    db.exec('ALTER TABLE test_cases_new RENAME TO test_cases');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function createTestCasesTable(db, tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error('Invalid test case table name');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      project_id INTEGER NOT NULL DEFAULT 1,
      id TEXT NOT NULL,
      module_id INTEGER NOT NULL,
      module_name TEXT NOT NULL,
      bg_info TEXT,
      title TEXT NOT NULL,
      precondition TEXT,
      steps TEXT NOT NULL,
      expected TEXT NOT NULL,
      status TEXT DEFAULT 'untested',
      notes TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (project_id, id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
}

module.exports = { ensurePlatformSchema };
