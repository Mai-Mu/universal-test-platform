const STATUS_META = [
  { key: "passed", label: "已通过", color: "#20a374" },
  { key: "failed", label: "未通过", color: "#e25d5d" },
  { key: "blocked", label: "已阻塞", color: "#e6a23c" },
  { key: "untested", label: "未测试", color: "#94a3b8" }
];

export function buildStandaloneReport({
  projectName = "未命名测试项目",
  testCases = [],
  folderOrder = [],
  generatedAt = new Date()
} = {}) {
  const safeCases = Array.isArray(testCases) ? testCases : [];
  const safeFolderOrder = Array.isArray(folderOrder) ? folderOrder : [];
  const reportDate = normalizeDate(generatedAt);
  const model = buildReportModel(safeCases, safeFolderOrder);
  const { overall, modules, folders } = model;
  const executed = overall.total - overall.untested;
  const executionPct = percent(executed, overall.total);
  const overallPassPct = percent(overall.passed, overall.total);
  const executedPassPct = percent(overall.passed, executed);
  const reportTime = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(reportDate);
  const safeProjectName = escapeHtml(projectName);
  const folderChart = renderFolderChart(folders);
  const riskChart = renderRiskChart(modules);
  const hierarchy = renderHierarchy(folders);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeProjectName} - 测试数据报告</title>
  <style>
    :root {
      --page: #f4f8fa;
      --surface: #ffffff;
      --surface-soft: #eef5f7;
      --text: #17324d;
      --muted: #6c8194;
      --line: #dce7ed;
      --blue: #4f86e8;
      --teal: #42a6a4;
      --passed: #20a374;
      --failed: #e25d5d;
      --blocked: #e6a23c;
      --untested: #94a3b8;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--page);
      color: var(--text);
      font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }

    .report {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 32px 0 48px;
    }

    .report-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--line);
    }

    .brand {
      margin-bottom: 8px;
      color: var(--teal);
      font-size: 12px;
      font-weight: 700;
    }

    h1, h2, h3, p { margin-top: 0; }

    h1 {
      margin-bottom: 8px;
      font-size: clamp(25px, 4vw, 38px);
      line-height: 1.2;
      letter-spacing: 0;
    }

    .report-subtitle {
      margin: 0;
      color: var(--muted);
    }

    .report-tag {
      flex-shrink: 0;
      padding: 7px 10px;
      border: 1px solid #b9d9da;
      border-radius: 6px;
      background: #edf8f7;
      color: #247b78;
      font-size: 12px;
      font-weight: 700;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 22px 0;
    }

    .metric {
      min-width: 0;
      padding: 18px;
      border: 1px solid var(--line);
      border-top: 3px solid var(--metric-color);
      border-radius: 8px;
      background: var(--surface);
    }

    .metric-label {
      display: block;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }

    .metric-value {
      display: block;
      margin-bottom: 4px;
      font-size: 28px;
      font-weight: 750;
      line-height: 1;
    }

    .metric-note {
      color: var(--muted);
      font-size: 12px;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
      gap: 14px;
      margin-bottom: 14px;
    }

    .panel {
      min-width: 0;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    .panel + .panel { margin-top: 14px; }
    .dashboard-grid .panel + .panel { margin-top: 0; }

    .panel-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }

    .panel-heading h2 {
      margin-bottom: 3px;
      font-size: 17px;
    }

    .panel-heading p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
    }

    .donut-layout {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      align-items: center;
      gap: 22px;
    }

    .donut {
      position: relative;
      width: 172px;
      height: 172px;
      border-radius: 50%;
      background: ${buildDonutBackground(overall)};
    }

    .donut::after {
      content: "";
      position: absolute;
      inset: 26px;
      border-radius: 50%;
      background: var(--surface);
    }

    .donut-center {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .donut-center strong {
      font-size: 27px;
      line-height: 1;
    }

    .donut-center span {
      margin-top: 5px;
      color: var(--muted);
      font-size: 12px;
    }

    .legend {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .legend-item {
      display: grid;
      grid-template-columns: 9px 1fr auto;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .legend-dot {
      width: 9px;
      height: 9px;
      border-radius: 3px;
    }

    .legend-label { color: var(--muted); }
    .legend-value { font-weight: 750; }

    .progress-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }

    .progress-summary-item {
      padding: 12px;
      border-radius: 6px;
      background: var(--surface-soft);
    }

    .progress-summary-item span {
      display: block;
      color: var(--muted);
      font-size: 11px;
    }

    .progress-summary-item strong { font-size: 20px; }

    .stack-track {
      display: flex;
      width: 100%;
      height: 12px;
      overflow: hidden;
      border-radius: 4px;
      background: #e8eff4;
    }

    .stack-track span { height: 100%; }

    .stack-caption {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .chart-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .chart-row-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 7px;
    }

    .chart-row-name {
      overflow: hidden;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chart-row-meta {
      flex-shrink: 0;
      color: var(--muted);
      font-size: 12px;
    }

    .risk-track {
      display: flex;
      width: 100%;
      height: 10px;
      overflow: hidden;
      border-radius: 3px;
      background: #edf2f5;
    }

    .risk-failed { background: var(--failed); }
    .risk-blocked { background: var(--blocked); }

    .risk-legend {
      display: flex;
      gap: 14px;
      color: var(--muted);
      font-size: 11px;
    }

    .risk-legend span::before {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 5px;
      border-radius: 2px;
      background: var(--legend-color);
    }

    .tree-folder + .tree-folder { margin-top: 16px; }

    .folder-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 14px;
      border-left: 3px solid var(--teal);
      border-radius: 6px;
      background: var(--surface-soft);
    }

    .folder-name {
      overflow: hidden;
      font-weight: 750;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .folder-meta {
      flex-shrink: 0;
      color: var(--muted);
      font-size: 12px;
    }

    .folder-body {
      margin-left: 17px;
      padding: 9px 0 0 16px;
      overflow-x: auto;
      border-left: 1px solid #c9dbe2;
    }

    .module-row {
      position: relative;
      display: grid;
      grid-template-columns: minmax(230px, 1fr) repeat(5, minmax(58px, 0.22fr));
      align-items: center;
      min-width: 660px;
      padding: 9px 10px;
      border-bottom: 1px solid #e9eff3;
      font-size: 12px;
      text-align: center;
    }

    .module-row::before {
      content: "";
      position: absolute;
      left: -17px;
      width: 12px;
      border-top: 1px solid #c9dbe2;
    }

    .module-row-head {
      color: var(--muted);
      font-size: 11px;
      font-weight: 700;
    }

    .module-name {
      overflow: hidden;
      padding-right: 16px;
      font-weight: 650;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .count-passed { color: var(--passed); font-weight: 700; }
    .count-failed { color: var(--failed); font-weight: 700; }
    .count-blocked { color: var(--blocked); font-weight: 700; }
    .count-untested { color: #718397; font-weight: 700; }

    .empty-state {
      padding: 28px;
      border: 1px dashed var(--line);
      border-radius: 6px;
      color: var(--muted);
      text-align: center;
    }

    .report-footer {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
    }

    @media (max-width: 860px) {
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .dashboard-grid { grid-template-columns: 1fr; }
      .dashboard-grid .panel + .panel { margin-top: 0; }
    }

    @media (max-width: 560px) {
      .report { width: min(100% - 20px, 1180px); padding-top: 20px; }
      .report-header { flex-direction: column; }
      .metric-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
      .metric { padding: 14px; }
      .metric-value { font-size: 23px; }
      .panel { padding: 15px; }
      .donut-layout { grid-template-columns: 1fr; justify-items: center; }
      .legend { width: 100%; }
      .progress-summary { grid-template-columns: 1fr; }
      .folder-head { align-items: flex-start; flex-direction: column; gap: 3px; }
      .folder-meta { flex-shrink: 1; }
      .report-footer { flex-direction: column; }
    }

    @media print {
      body { background: #ffffff; }
      .report { width: 100%; padding: 0; }
      .panel, .metric, .tree-folder { break-inside: avoid; }
      .report-tag { border-color: var(--line); background: #ffffff; }
    }
  </style>
</head>
<body>
  <main class="report">
    <header class="report-header">
      <div>
        <div class="brand">TESTHUB · 测试数据报告</div>
        <h1>${safeProjectName}</h1>
        <p class="report-subtitle">生成时间：${escapeHtml(reportTime)} · ${folders.length} 个文件夹分组 · ${modules.length} 个测试模块</p>
      </div>
      <div class="report-tag">单文件 · 离线可查看</div>
    </header>

    <section class="metric-grid" aria-label="项目核心指标">
      ${renderMetric("用例总数", overall.total, `覆盖 ${modules.length} 个模块`, "#4f86e8")}
      ${renderMetric("执行进度", `${executionPct}%`, `${executed} 条已执行`, "#42a6a4")}
      ${renderMetric("总体通过率", `${overallPassPct}%`, `${overall.passed} 条已通过`, "#20a374")}
      ${renderMetric("已执行通过率", `${executedPassPct}%`, `基于 ${executed} 条已执行用例`, "#7a79d8")}
    </section>

    <section class="dashboard-grid">
      <article class="panel">
        <div class="panel-heading">
          <div>
            <h2>状态分布</h2>
            <p>当前项目全部测试用例构成</p>
          </div>
        </div>
        <div class="donut-layout">
          <div class="donut" role="img" aria-label="测试用例状态环形图">
            <div class="donut-center"><strong>${overall.total}</strong><span>测试用例</span></div>
          </div>
          <div class="legend">${renderLegend(overall)}</div>
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <div>
            <h2>整体执行情况</h2>
            <p>执行覆盖、通过表现与待测余量</p>
          </div>
        </div>
        <div class="progress-summary">
          <div class="progress-summary-item"><span>已执行</span><strong>${executed}</strong></div>
          <div class="progress-summary-item"><span>风险用例</span><strong>${overall.failed + overall.blocked}</strong></div>
          <div class="progress-summary-item"><span>待测试</span><strong>${overall.untested}</strong></div>
        </div>
        ${renderStatusStack(overall)}
        <div class="stack-caption"><span>执行进度 ${executionPct}%</span><span>总体通过率 ${overallPassPct}%</span></div>
      </article>
    </section>

    <section class="dashboard-grid">
      <article class="panel">
        <div class="panel-heading">
          <div>
            <h2>文件夹完成度</h2>
            <p>按项目一级目录汇总测试结果</p>
          </div>
        </div>
        ${folderChart}
      </article>

      <article class="panel">
        <div class="panel-heading">
          <div>
            <h2>模块风险条形图</h2>
            <p>按未通过与阻塞数量排序，最多展示 10 个模块</p>
          </div>
          <div class="risk-legend"><span style="--legend-color: var(--failed)">未通过</span><span style="--legend-color: var(--blocked)">已阻塞</span></div>
        </div>
        ${riskChart}
      </article>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <div>
          <h2>项目结构树</h2>
          <p>文件夹 → 测试模块 → 状态数量</p>
        </div>
      </div>
      ${hierarchy}
    </section>

    <footer class="report-footer">
      <span>TestHub 通用测试用例管理平台</span>
      <span>本报告为生成时刻的静态快照，不包含执行备注与用例正文。</span>
    </footer>
  </main>
</body>
</html>`;
}

function buildReportModel(testCases, folderOrder) {
  const overall = createStats();
  const moduleMap = new Map();

  testCases.forEach(testCase => {
    const moduleId = testCase.moduleId ?? "unknown";
    if (!moduleMap.has(moduleId)) {
      moduleMap.set(moduleId, {
        moduleId,
        moduleName: testCase.moduleName || `模块 ${moduleId}`,
        folderName: testCase.folderName || null,
        sortOrder: Number(testCase.moduleSortOrder) || 0,
        sequence: moduleMap.size,
        stats: createStats()
      });
    }

    const module = moduleMap.get(moduleId);
    if (!module.folderName && testCase.folderName) module.folderName = testCase.folderName;
    addStatus(overall, testCase.status);
    addStatus(module.stats, testCase.status);
  });

  const modules = Array.from(moduleMap.values()).sort((left, right) => {
    return left.sortOrder - right.sortOrder || left.sequence - right.sequence;
  });

  const orderedFolderNames = [];
  folderOrder.forEach(name => {
    if (name && !orderedFolderNames.includes(name)) orderedFolderNames.push(name);
  });
  modules.forEach(module => {
    if (module.folderName && !orderedFolderNames.includes(module.folderName)) {
      orderedFolderNames.push(module.folderName);
    }
  });

  const folders = orderedFolderNames
    .map(name => createFolderModel(name, modules.filter(module => module.folderName === name)))
    .filter(folder => folder.modules.length > 0);
  const unorganizedModules = modules.filter(module => !module.folderName);
  if (unorganizedModules.length > 0) {
    folders.push(createFolderModel("未分类模块", unorganizedModules));
  }

  return { overall, modules, folders };
}

function createFolderModel(name, modules) {
  const stats = createStats();
  modules.forEach(module => mergeStats(stats, module.stats));
  return { name, modules, stats };
}

function createStats() {
  return { total: 0, passed: 0, failed: 0, blocked: 0, untested: 0 };
}

function addStatus(stats, status) {
  stats.total += 1;
  if (STATUS_META.some(item => item.key === status)) {
    stats[status] += 1;
  } else {
    stats.untested += 1;
  }
}

function mergeStats(target, source) {
  target.total += source.total;
  STATUS_META.forEach(item => {
    target[item.key] += source[item.key];
  });
}

function renderMetric(label, value, note, color) {
  return `<article class="metric" style="--metric-color: ${color}">
    <span class="metric-label">${escapeHtml(label)}</span>
    <strong class="metric-value">${escapeHtml(value)}</strong>
    <span class="metric-note">${escapeHtml(note)}</span>
  </article>`;
}

function renderLegend(stats) {
  return STATUS_META.map(item => `<div class="legend-item">
    <span class="legend-dot" style="background: ${item.color}"></span>
    <span class="legend-label">${item.label}</span>
    <span class="legend-value">${stats[item.key]}</span>
  </div>`).join("");
}

function renderStatusStack(stats) {
  const segments = STATUS_META.map(item => {
    const width = percent(stats[item.key], stats.total, 2);
    return width > 0
      ? `<span style="width: ${width}%; background: ${item.color}" title="${item.label} ${stats[item.key]}"></span>`
      : "";
  }).join("");

  return `<div class="stack-track" role="img" aria-label="已通过 ${stats.passed}，未通过 ${stats.failed}，已阻塞 ${stats.blocked}，未测试 ${stats.untested}">${segments}</div>`;
}

function renderFolderChart(folders) {
  if (folders.length === 0) return '<div class="empty-state">当前项目暂无文件夹与模块数据。</div>';

  return `<div class="chart-list">${folders.map(folder => {
    const executed = folder.stats.total - folder.stats.untested;
    return `<div class="chart-row">
      <div class="chart-row-head">
        <span class="chart-row-name" title="${escapeHtml(folder.name)}">${escapeHtml(folder.name)}</span>
        <span class="chart-row-meta">${executed}/${folder.stats.total} 已执行 · ${percent(executed, folder.stats.total)}%</span>
      </div>
      ${renderStatusStack(folder.stats)}
    </div>`;
  }).join("")}</div>`;
}

function renderRiskChart(modules) {
  const riskyModules = modules
    .filter(module => module.stats.failed + module.stats.blocked > 0)
    .sort((left, right) => {
      const rightRisk = right.stats.failed + right.stats.blocked;
      const leftRisk = left.stats.failed + left.stats.blocked;
      return rightRisk - leftRisk || right.stats.total - left.stats.total;
    })
    .slice(0, 10);

  if (riskyModules.length === 0) {
    return '<div class="empty-state">当前项目没有未通过或阻塞用例。</div>';
  }

  const maxRisk = Math.max(...riskyModules.map(module => module.stats.failed + module.stats.blocked), 1);
  return `<div class="chart-list">${riskyModules.map(module => `<div class="chart-row">
    <div class="chart-row-head">
      <span class="chart-row-name" title="${escapeHtml(module.moduleName)}">${escapeHtml(module.moduleName)}</span>
      <span class="chart-row-meta">${module.stats.failed} 未通过 · ${module.stats.blocked} 阻塞</span>
    </div>
    <div class="risk-track" role="img" aria-label="${escapeHtml(module.moduleName)}：未通过 ${module.stats.failed}，阻塞 ${module.stats.blocked}">
      <span class="risk-failed" style="width: ${percent(module.stats.failed, maxRisk, 2)}%"></span>
      <span class="risk-blocked" style="width: ${percent(module.stats.blocked, maxRisk, 2)}%"></span>
    </div>
  </div>`).join("")}</div>`;
}

function renderHierarchy(folders) {
  if (folders.length === 0) return '<div class="empty-state">当前项目暂无可展示的层级数据。</div>';

  return folders.map(folder => {
    const executed = folder.stats.total - folder.stats.untested;
    const moduleRows = folder.modules.map(module => `<div class="module-row">
      <span class="module-name" title="${escapeHtml(module.moduleName)}">${escapeHtml(module.moduleName)}</span>
      <span>${module.stats.total}</span>
      <span class="count-passed">${module.stats.passed}</span>
      <span class="count-failed">${module.stats.failed}</span>
      <span class="count-blocked">${module.stats.blocked}</span>
      <span class="count-untested">${module.stats.untested}</span>
    </div>`).join("");

    return `<section class="tree-folder">
      <div class="folder-head">
        <span class="folder-name">${escapeHtml(folder.name)}</span>
        <span class="folder-meta">${folder.modules.length} 个模块 · ${folder.stats.total} 个用例 · ${percent(executed, folder.stats.total)}% 已执行</span>
      </div>
      <div class="folder-body">
        <div class="module-row module-row-head">
          <span class="module-name">测试模块</span><span>总数</span><span>通过</span><span>未通过</span><span>阻塞</span><span>未测试</span>
        </div>
        ${moduleRows}
      </div>
    </section>`;
  }).join("");
}

function buildDonutBackground(stats) {
  if (stats.total === 0) return "#e8eff4";

  let cursor = 0;
  const segments = STATUS_META.map(item => {
    const start = cursor;
    cursor += percent(stats[item.key], stats.total, 4);
    return `${item.color} ${start}% ${cursor}%`;
  });
  segments[segments.length - 1] = segments[segments.length - 1].replace(/ [\d.]+%$/, " 100%");
  return `conic-gradient(${segments.join(", ")})`;
}

function percent(value, total, precision = 0) {
  if (!total) return 0;
  const result = (Number(value) / Number(total)) * 100;
  return Number(result.toFixed(precision));
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
