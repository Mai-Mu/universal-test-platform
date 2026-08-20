import { apiFetch } from "../api.js";
import { state } from "../state.js";
import { ui } from "../ui.js";

const PROJECT_VISITS_KEY = "testPlatformProjectVisitsV1";

export async function loadProjects(ctx) {
  try {
    const response = await apiFetch("/api/projects");
    if (response.ok) {
      const projects = (await response.json()).map(normalizeProject);
      state.projects = projects;
      renderHome(ctx);
      return projects;
    }
  } catch (error) {
    console.error("Failed to load projects", error);
  }

  state.projects = [];
  renderHome(ctx);
  return [];
}

export function recordProjectVisit(projectId) {
  const numericId = Number(projectId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return;
  const visits = readProjectVisits();
  visits[numericId] = Date.now();
  writeProjectVisits(visits);
}

function renderHome(ctx) {
  const query = ctx.els.projectSearchInput?.value.trim().toLocaleLowerCase() || "";
  const visits = readProjectVisits();
  const sortedProjects = [...state.projects].sort((left, right) => {
    const visitDifference = (visits[right.id] || 0) - (visits[left.id] || 0);
    if (visitDifference !== 0) return visitDifference;
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });
  const filteredProjects = sortedProjects.filter(project => {
    if (!query) return true;
    return `${project.name} ${project.description || ""}`.toLocaleLowerCase().includes(query);
  });

  renderSummary(ctx, state.projects);
  renderContinueAction(ctx, sortedProjects, visits);
  renderProjects(ctx, filteredProjects, visits, query);
}

function renderSummary(ctx, projects) {
  const totals = projects.reduce((summary, project) => {
    summary.cases += project.caseCount;
    summary.passed += project.passedCount;
    summary.failed += project.failedCount;
    summary.blocked += project.blockedCount;
    return summary;
  }, { cases: 0, passed: 0, failed: 0, blocked: 0 });
  const executed = totals.passed + totals.failed + totals.blocked;
  const progress = totals.cases === 0 ? 0 : Math.round((executed / totals.cases) * 100);

  ctx.els.homeStatProjects.textContent = String(projects.length);
  ctx.els.homeStatCases.textContent = String(totals.cases);
  ctx.els.homeStatProgress.textContent = `${progress}%`;
  ctx.els.homeStatProgressBar.style.width = `${progress}%`;
  ctx.els.homeStatFailed.textContent = String(totals.failed);
  ctx.els.homeStatBlocked.textContent = String(totals.blocked);
}

function renderContinueAction(ctx, sortedProjects, visits) {
  const recentProject = sortedProjects.find(project => visits[project.id]);
  ctx.recentProject = recentProject || null;
  ctx.els.btnContinueProject.hidden = !recentProject;
  if (recentProject) {
    ctx.els.continueProjectLabel.textContent = `继续 ${recentProject.name}`;
    ctx.els.btnContinueProject.title = `继续最近访问的项目：${recentProject.name}`;
  }
}

function renderProjects(ctx, projects, visits, query) {
  const { projectsGrid, homeEmptyState } = ctx.els;
  projectsGrid.innerHTML = "";
  ctx.els.homeProjectCount.textContent = String(projects.length);

  projects.forEach(project => projectsGrid.appendChild(createProjectCard(ctx, project, visits[project.id])));

  const isEmpty = projects.length === 0;
  homeEmptyState.hidden = !isEmpty;
  if (!isEmpty) return;

  if (query && state.projects.length > 0) {
    ctx.els.homeEmptyTitle.textContent = "没有匹配的项目";
    ctx.els.homeEmptyDescription.textContent = "换一个项目名称或描述关键词试试。";
  } else {
    ctx.els.homeEmptyTitle.textContent = "还没有测试项目";
    ctx.els.homeEmptyDescription.textContent = "创建第一个项目后，就可以开始组织和执行测试用例。";
  }
}

function createProjectCard(ctx, project, visitedAt) {
  const executed = project.passedCount + project.failedCount + project.blockedCount;
  const progress = project.caseCount === 0 ? 0 : Math.round((executed / project.caseCount) * 100);
  const card = document.createElement("article");
  card.className = "project-card";
  card.setAttribute("data-project-id", String(project.id));

  const toolbar = document.createElement("div");
  toolbar.className = "project-card-toolbar";
  toolbar.append(
    createPlaceholderButton("置顶", pinIcon()),
    createPlaceholderButton("归档", archiveIcon()),
    createPlaceholderButton("删除", trashIcon(), "danger")
  );

  const openButton = document.createElement("button");
  openButton.className = "project-card-open";
  openButton.type = "button";
  openButton.setAttribute("aria-label", `打开项目：${project.name}`);
  openButton.addEventListener("click", () => ctx.openProject(project.id, project.name));

  const header = document.createElement("div");
  header.className = "project-card-header-row";
  const icon = document.createElement("span");
  icon.className = `project-card-icon tone-${project.id % 4}`;
  icon.textContent = project.name.trim().charAt(0).toLocaleUpperCase() || "T";
  const titleBox = document.createElement("div");
  titleBox.className = "project-card-title-box";
  const title = document.createElement("h3");
  title.textContent = project.name;
  const recent = document.createElement("span");
  recent.className = "project-card-recent";
  recent.textContent = formatLastVisited(visitedAt);
  titleBox.append(title, recent);
  header.append(icon, titleBox);

  const description = document.createElement("p");
  description.className = "project-card-description";
  description.textContent = project.description || "暂无项目描述";

  const progressHeader = document.createElement("div");
  progressHeader.className = "project-card-progress-header";
  const progressLabel = document.createElement("span");
  progressLabel.textContent = "测试完成度";
  const progressValue = document.createElement("strong");
  progressValue.textContent = `${progress}%`;
  progressHeader.append(progressLabel, progressValue);
  const progressTrack = document.createElement("div");
  progressTrack.className = "project-card-progress-track";
  const progressFill = document.createElement("span");
  progressFill.style.width = `${progress}%`;
  progressTrack.appendChild(progressFill);

  const stats = document.createElement("div");
  stats.className = "project-card-stats";
  stats.append(
    createCardStat("用例", project.caseCount),
    createCardStat("失败", project.failedCount, project.failedCount > 0 ? "failed" : ""),
    createCardStat("阻塞", project.blockedCount, project.blockedCount > 0 ? "blocked" : "")
  );

  openButton.append(header, description, progressHeader, progressTrack, stats);
  card.append(toolbar, openButton);
  return card;
}

function createCardStat(label, value, tone = "") {
  const stat = document.createElement("span");
  stat.className = `project-card-stat${tone ? ` ${tone}` : ""}`;
  const labelNode = document.createElement("small");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = String(value);
  stat.append(labelNode, valueNode);
  return stat;
}

function createPlaceholderButton(label, iconMarkup, tone = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `project-card-action${tone ? ` ${tone}` : ""}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = iconMarkup;
  button.addEventListener("click", event => {
    event.stopPropagation();
    ui.alert(`${label}功能暂未上线。`);
  });
  return button;
}

export function setupHomeEvents(ctx) {
  const {
    btnCreateProject,
    btnContinueProject,
    projectSearchInput,
    projectCreateDialog,
    projectCreateForm,
    btnCloseProjectDialog,
    btnCancelProject
  } = ctx.els;

  btnCreateProject?.addEventListener("click", () => openCreateDialog(ctx));
  btnCloseProjectDialog?.addEventListener("click", () => projectCreateDialog.close());
  btnCancelProject?.addEventListener("click", () => projectCreateDialog.close());
  btnContinueProject?.addEventListener("click", () => {
    if (ctx.recentProject) ctx.openProject(ctx.recentProject.id, ctx.recentProject.name);
  });
  projectSearchInput?.addEventListener("input", () => renderHome(ctx));
  projectCreateDialog?.addEventListener("click", event => {
    if (event.target === projectCreateDialog) projectCreateDialog.close();
  });
  projectCreateDialog?.addEventListener("close", () => resetCreateForm(ctx));
  projectCreateForm?.addEventListener("submit", event => createProject(ctx, event));
}

function openCreateDialog(ctx) {
  resetCreateForm(ctx);
  ctx.els.projectCreateDialog.showModal();
  ctx.els.projectNameInput.focus();
}

async function createProject(ctx, event) {
  event.preventDefault();
  const name = ctx.els.projectNameInput.value.trim();
  const description = ctx.els.projectDescriptionInput.value.trim();
  if (!name) {
    showCreateError(ctx, "请输入项目名称。所有项目需要一个清晰的名称。");
    ctx.els.projectNameInput.focus();
    return;
  }

  const button = ctx.els.btnSubmitProject;
  button.disabled = true;
  button.textContent = "正在创建...";
  ctx.els.projectCreateError.hidden = true;

  try {
    const response = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "创建失败，可能存在同名项目。");
    }
    ctx.els.projectCreateDialog.close();
    await ctx.loadProjects();
  } catch (error) {
    console.error("Failed to create project", error);
    showCreateError(ctx, error.message || "创建失败，请稍后重试。");
  } finally {
    button.disabled = false;
    button.textContent = "创建项目";
  }
}

function resetCreateForm(ctx) {
  ctx.els.projectCreateForm?.reset();
  ctx.els.projectCreateError.hidden = true;
  ctx.els.btnSubmitProject.disabled = false;
  ctx.els.btnSubmitProject.textContent = "创建项目";
}

function showCreateError(ctx, message) {
  ctx.els.projectCreateError.textContent = message;
  ctx.els.projectCreateError.hidden = false;
}

function normalizeProject(project) {
  return {
    ...project,
    id: Number(project.id),
    caseCount: Number(project.caseCount || 0),
    passedCount: Number(project.passedCount || 0),
    failedCount: Number(project.failedCount || 0),
    blockedCount: Number(project.blockedCount || 0),
    untestedCount: Number(project.untestedCount || 0)
  };
}

function readProjectVisits() {
  try {
    const value = JSON.parse(localStorage.getItem(PROJECT_VISITS_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch (error) {
    return {};
  }
}

function writeProjectVisits(visits) {
  try {
    localStorage.setItem(PROJECT_VISITS_KEY, JSON.stringify(visits));
  } catch (error) {
    console.warn("Failed to save project visit history", error);
  }
}

function formatLastVisited(timestamp) {
  if (!timestamp) return "尚未访问";
  const difference = Math.max(0, Date.now() - Number(timestamp));
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (difference < minute) return "刚刚访问";
  if (difference < hour) return `${Math.floor(difference / minute)} 分钟前访问`;
  if (difference < day) return `${Math.floor(difference / hour)} 小时前访问`;
  if (difference < day * 2) return "昨天访问";
  return `${Math.floor(difference / day)} 天前访问`;
}

function pinIcon() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 17-5 5"></path><path d="m15 4 5 5"></path><path d="M14 9.5 9.5 14"></path><path d="m6 11 7-7 7 7-7 7Z"></path></svg>';
}

function archiveIcon() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M5 6v14h14V6"></path><path d="M8 3h8l2 3H6Z"></path><path d="M9 10h6"></path></svg>';
}

function trashIcon() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>';
}
