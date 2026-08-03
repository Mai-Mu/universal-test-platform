import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { ensurePlatformSchema } = require('./lib/platform-db.cjs');
const {
  getImportResult,
  getProject,
  importPackage,
  listProjects,
  validatePackage
} = require('./lib/test-package-service.cjs');

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDir, '..');
const dbPath = path.resolve(process.env.TEST_PLATFORM_DB || path.join(projectRoot, 'data', 'testcases.db'));
const backupDir = path.resolve(process.env.TEST_PLATFORM_BACKUP_DIR || path.join(projectRoot, 'data', 'backups'));
const db = new DatabaseSync(dbPath);
ensurePlatformSchema(db);

const projectSelectorSchema = {
  type: 'object',
  properties: {
    projectId: { type: 'integer', minimum: 1, description: '平台项目 ID。与 projectName 二选一。' },
    projectName: { type: 'string', minLength: 1, description: '平台项目名称。与 projectId 二选一。' }
  },
  additionalProperties: false
};

const packageSchema = {
  type: 'object',
  required: ['project', 'folders'],
  additionalProperties: false,
  properties: {
    project: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1 },
        description: { type: 'string' }
      }
    },
    documents: {
      type: 'array',
      description: '测试资料中的范围、介绍、说明、注意事项和验收口径等非用例内容。',
      items: {
        type: 'object',
        required: ['title', 'content'],
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1 },
          content: { type: 'string', description: '支持 Markdown 列表、引用和表格。' }
        }
      }
    },
    folders: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'modules'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          modules: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'cases'],
              additionalProperties: false,
              properties: {
                name: { type: 'string', minLength: 1 },
                background: { type: 'string' },
                cases: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'title', 'steps'],
                    additionalProperties: false,
                    properties: {
                      id: {
                        type: 'string',
                        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$',
                        description: '项目内稳定且唯一的用例编号，例如 TC-P0-001。'
                      },
                      title: { type: 'string', minLength: 1 },
                      precondition: { type: 'string' },
                      steps: {
                        type: 'array',
                        minItems: 1,
                        items: {
                          type: 'object',
                          required: ['action', 'expected'],
                          additionalProperties: false,
                          properties: {
                            action: { type: 'string', minLength: 1 },
                            expected: { type: 'string', minLength: 1 }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

const importInputSchema = {
  type: 'object',
  required: ['mode', 'package'],
  additionalProperties: false,
  properties: {
    mode: {
      type: 'string',
      enum: ['create', 'append', 'upsert'],
      description: 'create 新建项目；append 只追加且拒绝重复编号；upsert 按编号新增或更新并保留执行状态和备注。'
    },
    source: { type: 'string', description: '来源文档、任务或 Codex 会话的简短说明。' },
    package: packageSchema
  }
};

const tools = [
  {
    name: 'list_test_projects',
    description: '列出测试平台现有项目及用例、模块数量。新建或追加前应先调用，避免选错项目。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_test_project',
    description: '读取一个项目的说明、目录、模块、用例、状态和备注。增量生成或更新前使用。',
    inputSchema: projectSelectorSchema
  },
  {
    name: 'validate_test_package',
    description: '预检结构化测试包，不写数据库。正式导入前必须先调用并解决所有 errors。',
    inputSchema: importInputSchema
  },
  {
    name: 'import_test_package',
    description: '以事务导入已预检的测试包。导入前自动备份，失败时整体回滚并记录批次结果。',
    inputSchema: importInputSchema
  },
  {
    name: 'get_import_result',
    description: '按批次 ID 查询导入模式、来源、备份、统计结果或失败原因。',
    inputSchema: {
      type: 'object',
      required: ['batchId'],
      additionalProperties: false,
      properties: { batchId: { type: 'integer', minimum: 1 } }
    }
  }
];

const server = new Server(
  { name: 'universal-test-platform-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (name === 'list_test_projects') return jsonResult({ projects: listProjects(db) });

    if (name === 'get_test_project') {
      const project = getProject(db, args);
      return project
        ? jsonResult(project)
        : jsonResult({ error: 'Project not found' }, true);
    }

    if (name === 'validate_test_package') {
      return jsonResult(publicValidation(validatePackage(db, args)));
    }

    if (name === 'import_test_package') {
      const result = importPackage(db, args, { dbPath, backupDir });
      return jsonResult(result, !result.imported);
    }

    if (name === 'get_import_result') {
      const result = getImportResult(db, Number(args.batchId));
      return result
        ? jsonResult(result)
        : jsonResult({ error: 'Import batch not found' }, true);
    }

    return jsonResult({ error: `Unknown tool: ${name}` }, true);
  } catch (error) {
    return jsonResult({ error: error.message }, true);
  }
});

function publicValidation(result) {
  const { normalized, ...publicResult } = result;
  return publicResult;
}

function jsonResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    isError
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Universal Test Platform MCP v2 connected (${dbPath})`);
