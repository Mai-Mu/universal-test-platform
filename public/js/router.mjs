const PROJECT_CASE_FILTERS = new Set(["all", "passed", "failed", "blocked", "untested"]);

export function normalizeProjectCaseFilter(filter) {
  return PROJECT_CASE_FILTERS.has(filter) ? filter : "all";
}

export function parseAppRoute(pathname = "/", search = "") {
  const normalizedPath = normalizePath(pathname);

  if (normalizedPath === "/") {
    return { page: "home" };
  }

  const backupMatch = normalizedPath.match(/^\/projects\/(\d+)\/backups$/);
  if (backupMatch) {
    const projectId = parsePositiveInteger(backupMatch[1]);
    if (projectId === null) return { page: "not-found" };

    return {
      page: "project",
      projectId,
      view: "backup"
    };
  }

  const projectMatch = normalizedPath.match(/^\/projects\/(\d+)$/);
  if (!projectMatch) {
    return { page: "not-found" };
  }

  const projectId = parsePositiveInteger(projectMatch[1]);
  if (projectId === null) return { page: "not-found" };
  const params = new URLSearchParams(search);

  if (params.get("view") === "docs") {
    return {
      page: "project",
      projectId,
      view: "project-docs"
    };
  }

  if (params.get("view") === "cases") {
    return {
      page: "project",
      projectId,
      view: "project-cases",
      filter: normalizeProjectCaseFilter(params.get("status"))
    };
  }

  const moduleId = parsePositiveInteger(params.get("module"));
  if (moduleId !== null) {
    return {
      page: "project",
      projectId,
      view: "module",
      moduleId
    };
  }

  return {
    page: "project",
    projectId,
    view: "dashboard"
  };
}

export function buildAppUrl(route) {
  if (!route || route.page === "home") return "/";

  const projectId = parsePositiveInteger(route.projectId);
  if (route.page !== "project" || projectId === null) return "/";

  const projectPath = `/projects/${projectId}`;
  if (route.view === "backup") return `${projectPath}/backups`;
  if (route.view === "project-docs") return `${projectPath}?view=docs`;

  if (route.view === "module") {
    const moduleId = parsePositiveInteger(route.moduleId);
    return moduleId === null ? projectPath : `${projectPath}?module=${moduleId}`;
  }

  if (route.view === "project-cases") {
    const params = new URLSearchParams({ view: "cases" });
    const filter = normalizeProjectCaseFilter(route.filter);
    if (filter !== "all") params.set("status", filter);
    return `${projectPath}?${params.toString()}`;
  }

  return projectPath;
}

function normalizePath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return "/";
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? "");
  if (!/^\d+$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
