import { getModules, state } from "../state.js";
import { createCaseCard } from "./cases.js";

const STATUS_OPTIONS = [
  { value: "all", label: "全部", title: "全部项目用例" },
  { value: "passed", label: "已通过", title: "已通过用例" },
  { value: "failed", label: "未通过", title: "未通过用例" },
  { value: "blocked", label: "已阻塞", title: "已阻塞用例" },
  { value: "untested", label: "未测试", title: "未测试用例" }
];

export function setupProjectCaseEvents(ctx) {
  ctx.els.btnBackDashboard?.addEventListener("click", () => {
    ctx.switchView(null);
  });

  ctx.els.projectFilterButtons.forEach(button => {
    button.addEventListener("click", () => {
      ctx.openProjectCases(button.getAttribute("data-project-filter"), { historyMode: "replace" });
    });
  });
}

export function renderProjectCases(ctx) {
  const filter = normalizeFilter(state.currentProjectFilter);
  state.currentProjectFilter = filter;

  const matchedCases = state.testCases.filter(testCase => {
    return filter === "all" || testCase.status === filter;
  });
  const groups = buildCaseGroups(matchedCases);
  const moduleCount = groups.reduce((total, group) => total + group.modules.length, 0);

  const activeOption = STATUS_OPTIONS.find(option => option.value === filter);
  ctx.els.projectCasesTitle.textContent = activeOption.title;
  ctx.els.projectCasesSummary.textContent = `${matchedCases.length} 个用例 · ${groups.length} 个文件夹分组 · ${moduleCount} 个模块`;

  updateFilterButtons(ctx, filter);
  ctx.els.projectCasesGroups.innerHTML = "";

  if (matchedCases.length === 0) {
    ctx.els.projectCasesGroups.appendChild(createEmptyState(activeOption.label));
    return;
  }

  groups.forEach(group => {
    ctx.els.projectCasesGroups.appendChild(createFolderGroup(ctx, group));
  });
}

function normalizeFilter(filter) {
  return STATUS_OPTIONS.some(option => option.value === filter) ? filter : "all";
}

function updateFilterButtons(ctx, activeFilter) {
  const counts = { all: state.testCases.length, passed: 0, failed: 0, blocked: 0, untested: 0 };
  state.testCases.forEach(testCase => {
    if (Object.hasOwn(counts, testCase.status)) {
      counts[testCase.status] += 1;
    }
  });

  ctx.els.projectFilterButtons.forEach(button => {
    const filter = button.getAttribute("data-project-filter");
    const isActive = filter === activeFilter;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));

    const count = button.querySelector("[data-project-filter-count]");
    if (count) count.textContent = counts[filter] ?? 0;
  });
}

function buildCaseGroups(matchedCases) {
  const matchedIds = new Set(matchedCases.map(testCase => testCase.id));
  const modules = getModules()
    .map(module => ({
      ...module,
      cases: state.testCases
        .filter(testCase => testCase.moduleId === module.moduleId && matchedIds.has(testCase.id))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
    }))
    .filter(module => module.cases.length > 0);

  const folderNames = [...state.folders];
  modules.forEach(module => {
    if (module.folderName && !folderNames.includes(module.folderName)) {
      folderNames.push(module.folderName);
    }
  });

  const groups = folderNames
    .map(folderName => ({
      folderName,
      modules: modules.filter(module => module.folderName === folderName)
    }))
    .filter(group => group.modules.length > 0);

  const unorganizedModules = modules.filter(module => !module.folderName);
  if (unorganizedModules.length > 0) {
    groups.push({ folderName: null, modules: unorganizedModules });
  }

  return groups;
}

function createFolderGroup(ctx, group) {
  const folderKey = group.folderName || "__unorganized__";
  const folderLabel = group.folderName || "未分类模块";
  const caseCount = group.modules.reduce((total, module) => total + module.cases.length, 0);
  const isCollapsed = state.projectCollapsedFolders.has(folderKey);

  const section = document.createElement("section");
  section.className = "project-case-folder";
  section.setAttribute("data-folder-group", folderKey);
  section.classList.toggle("collapsed", isCollapsed);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "project-folder-toggle";
  toggle.setAttribute("aria-expanded", String(!isCollapsed));

  const identity = document.createElement("span");
  identity.className = "project-folder-identity";

  const arrow = document.createElement("span");
  arrow.className = "project-folder-arrow";
  arrow.textContent = "▼";
  arrow.setAttribute("aria-hidden", "true");

  const icon = document.createElement("span");
  icon.className = "project-folder-icon";
  icon.textContent = "📁";
  icon.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "project-folder-title";
  title.textContent = folderLabel;

  const count = document.createElement("span");
  count.className = "project-folder-count";
  count.textContent = `${caseCount} 个用例`;

  identity.appendChild(arrow);
  identity.appendChild(icon);
  identity.appendChild(title);
  toggle.appendChild(identity);
  toggle.appendChild(count);

  const content = document.createElement("div");
  content.className = "project-folder-content";
  group.modules.forEach(module => {
    content.appendChild(createModuleGroup(ctx, module));
  });

  toggle.addEventListener("click", () => {
    const collapsed = section.classList.toggle("collapsed");
    toggle.setAttribute("aria-expanded", String(!collapsed));
    if (collapsed) {
      state.projectCollapsedFolders.add(folderKey);
    } else {
      state.projectCollapsedFolders.delete(folderKey);
    }
  });

  section.appendChild(toggle);
  section.appendChild(content);
  return section;
}

function createModuleGroup(ctx, module) {
  const section = document.createElement("section");
  section.className = "project-case-module";
  section.setAttribute("data-module-group", module.moduleId);

  const header = document.createElement("div");
  header.className = "project-module-header";

  const identity = document.createElement("div");
  identity.className = "project-module-identity";

  const marker = document.createElement("span");
  marker.className = "project-module-marker";
  marker.setAttribute("aria-hidden", "true");

  const title = document.createElement("h3");
  title.className = "project-module-title";
  title.textContent = module.moduleName;

  const count = document.createElement("span");
  count.className = "project-module-count";
  count.textContent = `${module.cases.length} 个`;

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "project-module-open";
  openButton.textContent = "→";
  openButton.title = `打开模块：${module.moduleName}`;
  openButton.setAttribute("aria-label", `打开模块：${module.moduleName}`);
  openButton.addEventListener("click", () => {
    ctx.switchView(module.moduleId);
  });

  identity.appendChild(marker);
  identity.appendChild(title);
  identity.appendChild(count);
  header.appendChild(identity);
  header.appendChild(openButton);

  const cases = document.createElement("div");
  cases.className = "project-module-cases cases-list";
  module.cases.forEach(testCase => {
    cases.appendChild(createCaseCard(ctx, testCase, {
      onStatusChanged: ({ previousStatus, status }) => {
        if (previousStatus !== status) renderProjectCases(ctx);
      }
    }));
  });

  section.appendChild(header);
  section.appendChild(cases);
  return section;
}

function createEmptyState(statusLabel) {
  const empty = document.createElement("div");
  empty.className = "project-cases-empty";

  const icon = document.createElement("span");
  icon.className = "project-cases-empty-icon";
  icon.textContent = "○";
  icon.setAttribute("aria-hidden", "true");

  const title = document.createElement("h3");
  title.textContent = `暂无${statusLabel}用例`;

  const description = document.createElement("p");
  description.textContent = "当前项目在这个状态下还没有测试用例。";

  empty.appendChild(icon);
  empty.appendChild(title);
  empty.appendChild(description);
  return empty;
}
