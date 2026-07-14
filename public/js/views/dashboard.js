import { getModules, state } from "../state.js";

export function renderDashboard(ctx) {
  const {
    statTotal,
    statPassed,
    statFailed,
    statBlocked,
    statUntested,
    progressBarFill,
    progressPctText,
    circularProgressFill,
    circularPctText,
    dashboardModuleList
  } = ctx.els;

  const total = state.testCases.length;
  const passed = state.testCases.filter(testCase => testCase.status === "passed").length;
  const failed = state.testCases.filter(testCase => testCase.status === "failed").length;
  const blocked = state.testCases.filter(testCase => testCase.status === "blocked").length;
  const untested = state.testCases.filter(testCase => testCase.status === "untested").length;

  statTotal.textContent = total;
  statPassed.textContent = passed;
  statFailed.textContent = failed;
  statBlocked.textContent = blocked;
  statUntested.textContent = untested;

  const completed = total - untested;
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  progressBarFill.style.width = `${completionPct}%`;
  progressPctText.textContent = `${completionPct}%`;

  const passRatePct = total > 0 ? Math.round((passed / total) * 100) : 0;
  circularPctText.textContent = `${passRatePct}%`;
  circularProgressFill.setAttribute("stroke-dasharray", `${passRatePct} 100`);

  dashboardModuleList.innerHTML = "";
  getModules().forEach(module => {
    const moduleCases = state.testCases.filter(testCase => testCase.moduleId === module.moduleId);
    const moduleTotal = moduleCases.length;
    const modulePassed = moduleCases.filter(testCase => testCase.status === "passed").length;
    const modulePct = moduleTotal > 0 ? Math.round((modulePassed / moduleTotal) * 100) : 0;

    const item = document.createElement("div");
    item.className = "quick-module-item";

    const moduleTitle = document.createElement("span");
    moduleTitle.className = "quick-module-title";
    moduleTitle.textContent = module.moduleName;

    const moduleStatus = document.createElement("div");
    moduleStatus.className = "quick-module-status";

    const progressTrack = document.createElement("div");
    progressTrack.className = "mini-progress-track";

    const progressFill = document.createElement("div");
    progressFill.className = "mini-progress-fill";
    progressFill.style.width = `${modulePct}%`;
    progressFill.style.backgroundColor = modulePct === 100 ? "var(--success)" : "var(--primary)";

    const pctText = document.createElement("span");
    pctText.className = "quick-module-pct";
    pctText.style.color = modulePct === 100 ? "var(--success)" : "inherit";
    pctText.textContent = `${modulePct}%`;

    progressTrack.appendChild(progressFill);
    moduleStatus.appendChild(progressTrack);
    moduleStatus.appendChild(pctText);
    item.appendChild(moduleTitle);
    item.appendChild(moduleStatus);

    item.addEventListener("click", () => {
      ctx.switchView(module.moduleId);
    });

    dashboardModuleList.appendChild(item);
  });
}

export function setupDashboardEvents(ctx) {
  ctx.els.statCards.forEach(card => {
    card.addEventListener("click", () => {
      ctx.openProjectCases(card.getAttribute("data-project-status"));
    });
  });
}
