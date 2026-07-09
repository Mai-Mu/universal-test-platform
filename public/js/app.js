import { apiFetch } from "./api.js";
import { getElements } from "./dom.js";
import { getModules, state } from "./state.js";
import { setupBackupEvents, loadBackups } from "./views/backups.js";
import { setupCaseEvents, renderModuleCases } from "./views/cases.js";
import { renderDashboard } from "./views/dashboard.js";
import { setupHomeEvents, loadProjects } from "./views/home.js";
import { setupImportExportEvents } from "./views/importExport.js";
import { renderSidebarModules, setupSidebarEvents } from "./views/sidebar.js";
import { ui } from "./ui.js";

export function startApp() {
  const ctx = {
    els: getElements(),
    openProject: null,
    loadProjects: null,
    loadData: null,
    switchView: null
  };

  ctx.loadProjects = () => loadProjects(ctx);
  ctx.loadData = () => loadData(ctx);
  ctx.switchView = moduleId => switchView(ctx, moduleId);
  ctx.openProject = (projectId, projectName) => openProject(ctx, projectId, projectName);

  setupEventListeners(ctx);
  ctx.loadProjects();
}

async function loadData(ctx) {
  try {
    const foldersResponse = await apiFetch("/api/folders");
    if (foldersResponse.ok) {
      state.folders = await foldersResponse.json();
    }

    const response = await apiFetch("/api/testcases");
    if (!response.ok) {
      throw new Error("Failed to fetch test cases from API");
    }

    state.testCases = await response.json();
    renderSidebarModules(ctx);
    renderDashboard(ctx);

    if (typeof state.currentModuleId === "number") {
      renderModuleCases(ctx);
    }
  } catch (error) {
    console.error("Error loading test case data: ", error);
  }
}

async function openProject(ctx, projectId, projectName) {
  state.currentProjectId = projectId;
  state.currentProjectName = projectName || "测试总览";
  state.currentModuleId = null;
  state.currentFilter = "all";
  ctx.els.homeView.style.display = "none";
  ctx.els.workspaceView.style.display = "flex";
  await ctx.loadData();
  ctx.switchView(null);
}

function switchView(ctx, moduleId) {
  state.currentModuleId = moduleId;

  document.querySelectorAll(".sidebar-menu .menu-item").forEach(item => {
    item.classList.remove("active");
  });

  ctx.els.viewDashboard.style.display = "none";
  ctx.els.viewModuleCases.style.display = "none";
  ctx.els.viewBackup.style.display = "none";

  if (moduleId === null) {
    ctx.els.navDashboard.classList.add("active");
    ctx.els.viewDashboard.style.display = "block";
    ctx.els.pageTitle.textContent = state.currentProjectName;
    if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "flex";
    if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "none";
    renderDashboard(ctx);
    return;
  }

  if (moduleId === "backup") {
    ctx.els.viewBackup.style.display = "block";
    ctx.els.pageTitle.textContent = "备份管理";
    if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "none";
    if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "none";
    loadBackups(ctx);
    return;
  }

  const activeNav = document.getElementById(`nav-module-${moduleId}`);
  if (activeNav) activeNav.classList.add("active");
  ctx.els.viewModuleCases.style.display = "block";

  const targetModule = getModules().find(module => module.moduleId === moduleId);
  ctx.els.pageTitle.textContent = targetModule ? targetModule.moduleName : "测试用例";
  if (ctx.els.btnEditProject) ctx.els.btnEditProject.style.display = "none";
  if (ctx.els.btnResetModule) ctx.els.btnResetModule.style.display = "inline-flex";

  state.currentFilter = "all";
  ctx.els.filterButtons.forEach(button => button.classList.remove("active"));
  document.querySelector(".filter-bar [data-filter='all']").classList.add("active");

  renderModuleCases(ctx);
}

function setupEventListeners(ctx) {
  ctx.els.navDashboard.addEventListener("click", () => {
    ctx.switchView(null);
  });

  setupBackupEvents(ctx);
  setupCaseEvents(ctx);
  setupHomeEvents(ctx);
  setupImportExportEvents(ctx);
  setupSidebarEvents(ctx);
  setupProjectTitleEvents(ctx);
}

function setupProjectTitleEvents(ctx) {
  const { headerTitleContainer, btnEditProject, pageTitle } = ctx.els;
  if (!headerTitleContainer || !btnEditProject) return;

  headerTitleContainer.addEventListener("mouseenter", () => {
    if (state.currentModuleId === null) {
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
        pageTitle.textContent = state.currentProjectName;
      } else {
        await ui.alert("修改失败，请重试。");
      }
    } catch (error) {
      console.error("Failed to update project name:", error);
      await ui.alert("修改失败，网络错误。");
    }
  });
}
