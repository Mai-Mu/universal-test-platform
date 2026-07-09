import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database
const dbPath = path.join(__dirname, "testcases.db");
const db = new DatabaseSync(dbPath);

const server = new Server(
  {
    name: "universal-test-platform-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define List Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_platform_context",
        description: "Get existing folders and modules to understand the platform categorization.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "insert_test_cases",
        description: "Batch insert test cases into the universal test management platform.",
        inputSchema: {
          type: "object",
          properties: {
            cases: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  folder_name: { type: "string", description: "Target folder name. If not provided, will be placed in uncategorized." },
                  module_name: { type: "string", description: "Target module name. E.g. '1. 出库管理'." },
                  title: { type: "string", description: "Title of the test case." },
                  precondition: { type: "string", description: "Preconditions." },
                  steps: { type: "array", items: { type: "string" }, description: "List of test steps." },
                  expected: { type: "array", items: { type: "string" }, description: "List of expected results." }
                },
                required: ["module_name", "title", "steps", "expected"]
              }
            }
          },
          required: ["cases"],
        },
      },
    ],
  };
});

// Handle Call Tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_platform_context") {
    const folders = db.prepare("SELECT * FROM folders ORDER BY sort_order ASC").all();
    const modules = db.prepare(`
      SELECT tc.module_id, tc.module_name, mf.folder_name 
      FROM test_cases tc
      LEFT JOIN module_folders mf ON tc.module_id = mf.module_id
      GROUP BY tc.module_id
    `).all();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ folders, modules }, null, 2),
        },
      ],
    };
  }

  if (name === "insert_test_cases") {
    const cases = args.cases;
    if (!Array.isArray(cases)) {
      throw new Error("Invalid arguments: cases must be an array.");
    }

    try {
      db.exec('BEGIN TRANSACTION');

      let insertedCount = 0;

      for (const caseData of cases) {
        const { folder_name, module_name, title, precondition, steps, expected } = caseData;

        // Ensure folder exists if provided
        if (folder_name) {
          db.prepare(`INSERT OR IGNORE INTO folders (name, sort_order) VALUES (?, 0)`).run(folder_name);
        }

        // Find or create module_id
        let row = db.prepare("SELECT module_id FROM test_cases WHERE module_name = ? LIMIT 1").get(module_name);
        let moduleId;
        
        if (row) {
          moduleId = row.module_id;
        } else {
          // Get max module_id
          const maxRow = db.prepare("SELECT MAX(module_id) as max_id FROM test_cases").get();
          moduleId = (maxRow.max_id || 0) + 1;
        }

        // Ensure module_folder relation if folder_name is provided
        if (folder_name) {
          db.prepare(`
            INSERT INTO module_folders (module_id, folder_name) 
            VALUES (?, ?)
            ON CONFLICT(module_id) DO UPDATE SET folder_name=excluded.folder_name
          `).run(moduleId, folder_name);
        }

        // Generate ID
        const maxIdRow = db.prepare("SELECT id FROM test_cases WHERE module_id = ? ORDER BY id DESC LIMIT 1").get(moduleId);
        let nextNum = 1;
        if (maxIdRow) {
          const match = maxIdRow.id.match(/-(\d+)$/);
          if (match) {
            nextNum = parseInt(match[1], 10) + 1;
          }
        }
        const moduleStr = moduleId.toString().padStart(2, '0');
        const numStr = nextNum.toString().padStart(2, '0');
        const caseId = `TC-${moduleStr}-${numStr}`;

        // Prepare test cases format
        const stepsStr = Array.isArray(steps) ? JSON.stringify(steps) : JSON.stringify([steps]);
        const expectedStr = Array.isArray(expected) ? JSON.stringify(expected) : JSON.stringify([expected]);

        // Insert case
        db.prepare(`
          INSERT INTO test_cases (id, module_id, module_name, bg_info, title, precondition, steps, expected, status, notes, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(caseId, moduleId, module_name, "", title, precondition || "", stepsStr, expectedStr, "untested", "", 999);

        insertedCount++;
      }

      db.exec('COMMIT');

      return {
        content: [
          {
            type: "text",
            text: `Successfully inserted ${insertedCount} test cases. Refresh the browser to view them.`,
          },
        ],
      };
    } catch (error) {
      db.exec('ROLLBACK');
      console.error(error);
      return {
        content: [
          {
            type: "text",
            text: `Error inserting test cases: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Tool not found: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Universal Test Platform MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
