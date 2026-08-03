import { apiFetch } from "./api.js";
import { getElements } from "./dom.js";
import { buildAppUrl, normalizeProjectCaseFilter, parseAppRoute } from "./router.mjs";
import { getModules, state } from "./state.js";
import { setupBackupEvents, loadBackups } from "./views/backups.js";
import { setupCaseEvents, renderModuleCases } from "./views/cases.js";
import { renderDashboard, setupDashboardEvents } from "./views/dashboard.js";
import { setupHomeEvents, loadProjects } from "./views/home.js";
import { setupReportExportEvents } from "./views/reportExport.js";
import { renderProjectCases, setupProjectCaseEvents } from "./views/projectCases.js";
import { renderProjectDocs } from "./views/projectDocs.js";
import { renderSidebarModules, setupSidebarEvents } from "./views/sidebar.js";
import { ui } from "./ui.js";

const APP_TITLE = "通用测试用例管理平台";

export async function startApp() {
  const ctx = {
    els: getElements(),
    openProject: null,
    goHome: null,
    loadProjects: null,
    loadData: null,
    switchView: null,
    openProjectCases: null
  };

  ctx.loadProjects = () => loadProjects(ctx);
  ctx.loadData = () => loadData(ctx);
  ctx.switchView = (moduleId, options) => switchView(ctx, moduleId, options);
  ctx.openProjectCases = (filter, options) => openProjectCases(ctx, filter, options);
  ctx.openProject = (projectId, projectName, options) => openProject(ctx, projectId, projectName, options);
  ctx.goHome = options => showHome(ctx, options);

  setupEventListeners(ctx);
  window.addEventListener("popstate", () => {
    applyCurrentRoute(ctx).catch(error => {
      console.error("Failed to restore browser route:", error);
    });
  });

  await applyCurrentRoute(ctx);
}

async function loadData(ctx) {
  const projectId = state.currentProjectId;

  try {
    let folders = [];
    const foldersResponse = await apiFetch("/api/folders");
    if (foldersResponse.ok) {
      folders = await foldersResponse.json();
    }

    const response = await apiFetch("/api/testcases");
    if (!response.ok) {
      throw new Error("Failed to fetch test cases from API");
    }

    const testCases = await response.json();
    if (state.currentProjectId !== projectId) return false;

    state.folders = folders;
    state.testCases = testCases;
    renderSidebarModules(ctx);
    renderDashboard(ctx);

    if (state.currentView === "module" && typeof state.currentModuleId === "number") {
      renderModuleCases(ctx);
    } else if (state.currentView === "project-cases") {
      renderProjectCases(ctx);
    }
    return true;
  } catch (error) {
    console.error("Error loading test case data: ", error);
    return false;
  }
}

async function openProject(ctx, projectId, projectName, options = {}) {
  const numericProjectId = Number(projectId);
  if (!Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) {
    await showHome(ctx, { historyMode: "replace" });
    return;
  }

  const route = {
    page: "project",
    projectId: numericProjectId,
    view: options.view || "dashboard",
    moduleId: options.moduleId,
    filter: options.filter
  };

  state.currentProjectId = numericProjectId;
  state.currentProjectName = projectName || "测试总览";
  state.currentView = "dashboard";
  state.currentModuleId = null;
  state.currentFilter = "all";
  state.currentProjectFilter = "all";
  state.projectCollapsedFolders.clear();
  ctx.els.homeView.style.display = "none";
  ctx.els.workspaceView.style.display = "flex";
  closeMobileSidebar(ctx);
  writeBrowserRoute(route, options.historyMode || "push");

  const loaded = await ctx.loadData();
  if (!loaded || state.currentProjectId !== numericProjectId) return;

  applyProjectView(ctx, route, { historyMode: "replace" });
}

function switchView(ctx, moduleId, options = {}) {
  closeMobileSidebar(ctx);
  const isModule = Number.isSafeInteger(moduleId) && moduleId > 0;
  const isBackup = moduleId === "backup";
  const isProjectDocs = moduleId === "project-docs";
  state.currentView = isBackup ? "backup" : isProjectDocs ? "project-docs" : isModule ? "module" : "dashboard";
  state.currentModuleId = isModule ? moduleId : null;

  writeBrowserRoute({
    page: "project",
    projectId: state.currentProjectId,
    view: state.currentView,
    moduleId: state.currentModuleId
  }, options.historyMode || "push");

  document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
    item.classList.remove("active");
  });

  ctx.els.viewDashboard.style.display = "none";
  ctx.els.viewProjectDocs.style.display = "none";
  ctx.els.viewProjectCases.style.display = "none";
  ctx.els.viewModuleCases.style.display = "none";
  ctx.els.viewBackup.style.display = "none";

  if (state.currentView === "dashboard") {
    ctx.els.navDashboard.classList.add("active");
    ctx.els.viewDashboard.style.display = "block";
    ctx.els.pageTitle.textContent = state.currentProjectName;
    if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "flex";
    if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "none";
    setDocumentTitle(state.currentProjectName);
    renderDashboard(ctx);
    return;
  }

  if (state.currentView === "backup") {
    ctx.els.viewBackup.style.display = "block";
    ctx.els.pageTitle.textContent = "备份管理";
    if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "none";
    if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "none";
    setDocumentTitle(`${state.currentProjectName} · 备份管理`);
    loadBackups(ctx);
    return;
  }

  if (state.currentView === "project-docs") {
    ctx.els.navProjectDocs.classList.add("active");
    ctx.els.viewProjectDocs.style.display = "block";
    ctx.els.pageTitle.textContent = "项目说明";
    if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "none";
    if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "none";
    setDocumentTitle(`项目说明 · ${state.currentProjectName}`);
    renderProjectDocs(ctx);
    return;
  }

  const activeNav = document.getElementById(`nav-module-${moduleId}`);
  if (activeNav) activeNav.classList.add("active");
  ctx.els.projectCasesGroups.innerHTML = "";
  ctx.els.viewModuleCases.style.display = "block";

  const targetModule = getModules().find(module => module.moduleId === moduleId);
  ctx.els.pageTitle.textContent = targetModule ? targetModule.moduleName : "测试用例";
  if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "none";
  if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "inline-flex";
  setDocumentTitle(`${targetModule ? targetModule.moduleName : "测试用例"} · ${state.currentProjectName}`);

  state.currentFilter = "all";
  ctx.els.filterButtons.forEach(button => button.classList.remove("active"));
  document.querySelector(".filter-bar [data-filter='all']").classList.add("active");

  renderModuleCases(ctx);
}

function openProjectCases(ctx, filter, options = {}) {
  closeMobileSidebar(ctx);
  state.currentView = "project-cases";
  state.currentModuleId = null;
  state.currentProjectFilter = normalizeProjectCaseFilter(filter);

  writeBrowserRoute({
    page: "project",
    projectId: state.currentProjectId,
    view: "project-cases",
    filter: state.currentProjectFilter
  }, options.historyMode || "push");

  document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
    item.classList.remove("active");
  });
  ctx.els.navDashboard.classList.add("active");

  ctx.els.viewDashboard.style.display = "none";
  ctx.els.viewProjectDocs.style.display = "none";
  ctx.els.casesListContainer.innerHTML = "";
  ctx.els.viewModuleCases.style.display = "none";
  ctx.els.viewBackup.style.display = "none";
  ctx.els.viewProjectCases.style.display = "block";
  ctx.els.pageTitle.textContent = state.currentProjectName;
  if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "none";
  if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "none";
  setDocumentTitle(`项目用例 · ${state.currentProjectName}`);

  renderProjectCases(ctx);
}

async function showHome(ctx, options = {}) {
  closeMobileSidebar(ctx);
  state.currentView = "home";
  state.currentProjectId = null;
  state.currentModuleId = null;
  state.currentProjectFilter = "all";
  ctx.els.workspaceView.style.display = "none";
  ctx.els.homeView.style.display = "flex";
  writeBrowserRoute({ page: "home" }, options.historyMode || "push");
  setDocumentTitle();

  if (options.reloadProjects !== false) {
    await ctx.loadProjects();
  }
}

async function applyCurrentRoute(ctx) {
  const route = parseAppRoute(window.location.pathname, window.location.search);

  if (route.page === "home") {
    await showHome(ctx, { historyMode: "replace" });
    return;
  }

  if (route.page === "not-found") {
    await showHome(ctx, { historyMode: "replace" });
    return;
  }

  const projects = state.projects.length > 0 ? state.projects : await ctx.loadProjects();
  const project = projects.find(item => Number(item.id) === route.projectId);
  if (!project) {
    await showHome(ctx, { historyMode: "replace", reloadProjects: false });
    return;
  }

  if (state.currentProjectId !== route.projectId || state.currentView === "home") {
    await openProject(ctx, route.projectId, project.name, {
      view: route.view,
      moduleId: route.moduleId,
      filter: route.filter,
      historyMode: "replace"
    });
    return;
  }

  state.currentProjectName = project.name;
  ctx.els.homeView.style.display = "none";
  ctx.els.workspaceView.style.display = "flex";
  applyProjectView(ctx, route, { historyMode: "replace" });
}

function applyProjectView(ctx, route, options = {}) {
  const historyMode = options.historyMode || "replace";

  if (route.view === "backup") {
    switchView(ctx, "backup", { historyMode });
    return;
  }

  if (route.view === "project-docs") {
    switchView(ctx, "project-docs", { historyMode });
    return;
  }

  if (route.view === "module") {
    const moduleExists = getModules().some(module => module.moduleId === route.moduleId);
    if (moduleExists) {
      switchView(ctx, route.moduleId, { historyMode });
    } else {
      switchView(ctx, null, { historyMode: "replace" });
    }
    return;
  }

  if (route.view === "project-cases") {
    openProjectCases(ctx, route.filter, { historyMode });
    return;
  }

  switchView(ctx, null, { historyMode });
}

function writeBrowserRoute(route, historyMode) {
  if (historyMode === "none") return;

  const url = buildAppUrl(route);
  const currentUrl = `${window.location.pathname}${window.location.search}`;
  if (url === currentUrl) return;

  const method = historyMode === "replace" ? "replaceState" : "pushState";
  window.history[method]({}, "", url);
}

function setDocumentTitle(label) {
  document.title = label ? `${label} - ${APP_TITLE}` : APP_TITLE;
}

function setupEventListeners(ctx) {
  ctx.els.navDashboard.addEventListener("click", () => {
    ctx.switchView(null);
  });
  ctx.els.navProjectDocs.addEventListener("click", () => {
    ctx.switchView("project-docs");
  });
  ctx.els.brandHomeLink.addEventListener("click", event => {
    event.preventDefault();
    ctx.goHome();
  });

  setupBackupEvents(ctx);
  setupCaseEvents(ctx);
  setupDashboardEvents(ctx);
  setupHomeEvents(ctx);
  setupReportExportEvents(ctx);
  setupMobileSidebarEvents(ctx);
  setupProjectCaseEvents(ctx);
  setupSidebarEvents(ctx);
  setupProjectTitleEvents(ctx);
}

function setupMobileSidebarEvents(ctx) {
  const { btnMobileSidebar, btnCloseSidebar, sidebarBackdrop } = ctx.els;
  btnMobileSidebar?.addEventListener("click", () => {
    const shouldOpen = !ctx.els.sidebar.classList.contains("mobile-open");
    setMobileSidebarOpen(ctx, shouldOpen);
  });
  btnCloseSidebar?.addEventListener("click", () => setMobileSidebarOpen(ctx, false));
  sidebarBackdrop?.addEventListener("click", () => setMobileSidebarOpen(ctx, false));

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") setMobileSidebarOpen(ctx, false);
  });
}

function closeMobileSidebar(ctx) {
  setMobileSidebarOpen(ctx, false);
}

function setMobileSidebarOpen(ctx, isOpen) {
  if (!ctx.els.sidebar) return;
  ctx.els.sidebar.classList.toggle("mobile-open", isOpen);
  ctx.els.sidebarBackdrop?.classList.toggle("visible", isOpen);
  ctx.els.btnMobileSidebar?.setAttribute("aria-expanded", String(isOpen));
}

function setupProjectTitleEvents(ctx) {
  const { headerTitleContainer, btnEditProject, pageTitle } = ctx.els;
  if (!headerTitleContainer || !btnEditProject) return;

  headerTitleContainer.addEventListener("mouseenter", () => {
    if (state.currentView === "dashboard") {
      btnEditProject.style.opacity = "1";
    }
  });

  headerTitleContainer.addEventListener("mouseleave", () => {
    btnEditProject.style.opacity = "0";
  });

  btnEditProject.addEventListener("click", async () => {
    const newName = await ui.prompt("请输入新的项目名称", state.currentProjectName);
    if (!newName || newName.trim() === state.currentProjectName) return;

    try {
      const response = await apiFetch(`/api/projects/${state.currentProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() })
      });

      if (response.ok) {
        state.currentProjectName = newName.trim();
        const currentProject = state.projects.find(project => Number(project.id) === state.currentProjectId);
        if (currentProject) currentProject.name = state.currentProjectName;
        pageTitle.textContent = state.currentProjectName;
        setDocumentTitle(state.currentProjectName);
      } else {
        await ui.alert("修改失败，请重试。");
      }
    } catch (error) {
      console.error("Failed to update project name:", error);
      await ui.alert("修改失败，网络错误。");
    }
  });
}
