# 通用测试用例管理平台

这是一个面向各类软件项目的本地化“测试用例管理与执行”平台。它适合产品、研发、测试、实施团队在本机或内网环境中维护测试空间、组织功能模块、记录执行进度，并导出可审阅的测试报告。

平台不绑定特定行业、客户或系统类型。你可以用它管理 Web 应用、移动端、后台系统、接口联调、业务流程、回归测试、验收测试等不同场景的测试用例。

## 核心特性

- **多项目空间隔离**：支持创建多个测试项目，不同项目的数据、模块、文件夹和进度相互独立。
- **模块与文件夹管理**：左侧提供可折叠、可拖拽排序的模块目录树，方便按功能域、版本、团队或测试轮次组织用例。
- **测试进度总览**：Dashboard 自动统计总用例数、已通过、未通过、已阻塞、未测试，并展示完成度和通过率。
- **项目级状态筛选**：可从总览统计卡进入跨文件夹用例结果页，并按文件夹、模块、用例保留完整层级。
- **用例执行记录**：支持按状态筛选用例，标记测试结果，记录执行备注、实际结果、问题说明或测试数据。
- **单文件 HTML 报告**：可导出当前项目的离线数据看板，包含核心指标、状态环形图、文件夹完成度、模块风险条形图和项目结构树。
- **本地数据库存储**：使用 Node.js 原生 `node:sqlite` 存储数据，无需额外部署数据库服务。
- **自动备份与恢复**：支持手动备份、定时备份、备份下载、删除和数据库恢复。
- **Agent 扩展接口**：预留 MCP 服务，便于后续让 AI Agent 读取上下文或批量写入测试用例。

## 技术栈

- **前端**：HTML5 + 原生 JavaScript ES Modules + CSS3
- **后端**：Node.js + Express
- **数据库**：Node.js 原生 `node:sqlite`
- **定时任务**：node-cron
- **Agent 接口**：Model Context Protocol SDK

## 快速启动

1. 安装依赖：

   ```bash
   npm install
   ```

2. 启动服务：

   ```bash
   npm start
   ```

3. 打开浏览器访问：

   ```text
   http://localhost:3000
   ```

4. 运行基础验证：

   ```bash
   npm test
   ```

## Docker 公网部署

仓库提供 `Dockerfile`、`docker-compose.yml`、GitHub Actions 自动构建和普通 Nginx 容器反向代理示例，可在 Linux 云服务器上以单实例方式运行。应用只暴露在共享 Docker 网络中，不直接发布 3000 端口；SQLite 数据保存在宿主机 `data/` 目录。

Ubuntu 24.04 的完整部署、现有数据库迁移、DNS、阿里云安全组、密码生成、构建、验证、升级和回滚步骤，请参阅 [Docker 部署教程](docs/docker-deployment-ubuntu.md)。

## 页面地址

- `/`：测试空间大厅。
- `/projects/:projectId`：项目工作区，默认显示测试概览。
- `/projects/:projectId?module=:moduleId`：直接打开指定测试模块。
- `/projects/:projectId?view=cases&status=failed`：打开项目级用例列表并恢复状态筛选；`status` 支持 `passed`、`failed`、`blocked`、`untested`。
- `/projects/:projectId/backups`：打开当前项目的备份管理。

项目内切换会同步更新浏览器历史记录，因此可以刷新恢复当前页面，也可以使用浏览器的前进、后退或直接分享链接。

## 目录结构

```text
/
├── public/                 # 前端静态资源
│   ├── index.html          # 主页面入口
│   ├── app.js              # 前端模块入口
│   ├── styles.css          # 全局样式与组件样式
│   └── js/                 # 前端 ES Modules
│       ├── app.js          # 应用启动与视图调度
│       ├── api.js          # API 请求封装
│       ├── dom.js          # DOM 元素集中查询
│       ├── router.mjs      # 页面地址解析与生成
│       ├── state.js        # 前端状态
│       ├── ui.js           # 通用弹窗
│       ├── utils.js        # 通用工具函数
│       ├── reportBuilder.mjs # 单文件 HTML 报告生成器
│       └── views/          # 页面/区域模块
├── scripts/                # 验证脚本
├── src/                    # 后端与 Agent 源码
│   ├── server.js           # Express 服务和 SQLite API
│   ├── mcp-server.mjs      # MCP Agent 接口服务
│   └── lib/                # 数据库迁移与结构化导入逻辑
├── data/                   # 本地运行数据，不纳入版本控制
│   ├── testcases.db        # SQLite 数据库
│   └── backups/            # 自动、手动与 MCP 导入备份
└── package.json            # Node.js 项目配置
```

## 数据与版本控制建议

`data/` 属于本地运行数据，不提交到代码仓库。团队需要迁移或恢复完整数据时，应使用数据库备份文件或独立数据同步流程；HTML 报告适合评审和归档，不用于恢复测试进度，也不包含执行备注与用例正文。

系统默认按服务器本地时间每天 `02:00` 自动备份，并保留最近 30 份备份。若服务在 `02:00` 时未运行，当天稍后启动时会检查并补做一次；备份目录可通过 `BACKUP_DIR` 环境变量调整。

## 关于 MCP Server

项目通过 `src/mcp-server.mjs` 让 Codex 等支持 MCP 的 Agent 直接向平台提交结构化测试资产，不再依赖人工整理 Markdown 和二次导入。MCP 与 Web 服务共用 SQLite 数据库，支持项目说明、目录、模块、用例和导入审计。

### MCP 工具

- `list_test_projects`：列出项目及用例、模块数量。
- `get_test_project`：读取项目说明、目录、模块、用例和当前执行状态。
- `validate_test_package`：只做结构、重复编号和目标项目预检，不写数据库。
- `import_test_package`：自动备份后，以事务正式导入测试包。
- `get_import_result`：查询导入批次、来源、备份文件、统计或失败原因。

### 导入模式

- `create`：新建项目，项目重名时停止，不覆盖已有项目。
- `append`：向现有项目追加内容，发现已有用例编号时停止。
- `upsert`：按项目内用例编号新增或更新；更新正文时保留测试状态和备注。

推荐让 Agent 先调用 `list_test_projects` 确认目标，再调用 `validate_test_package`。预检没有 `errors` 后才调用 `import_test_package`。用例步骤使用 `{ action, expected }` 成对传递，防止操作和预期结果错位；范围、介绍、注意事项和验收口径放入 `documents`，平台会显示在“项目说明”页面。

测试命令：

```powershell
npm test       # Web 与 MCP 完整回归
npm run test:mcp
```
