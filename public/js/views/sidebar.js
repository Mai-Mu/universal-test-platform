import { apiFetch } from "../api.js";
import { getModules, state } from "../state.js";
import { ui } from "../ui.js";

export function renderSidebarModules(ctx) {
  const { foldersContainer, unorganizedContainer, unorganizedTitle } = ctx.els;
  foldersContainer.innerHTML = "";
  unorganizedContainer.innerHTML = "";

  const modules = getModules();

  state.folders.forEach(folderName => {
    const folderDiv = document.createElement("div");
    folderDiv.className = "sidebar-folder";
    folderDiv.setAttribute("data-folder-name", folderName);
    if (state.collapsedFolders.has(folderName)) {
      folderDiv.classList.add("collapsed");
    }

    const headerDiv = createFolderHeader(folderName);
    const listDiv = document.createElement("div");
    listDiv.className = "folder-modules-list";
    listDiv.setAttribute("data-folder-name", folderName);

    if (!state.collapsedFolders.has(folderName)) {
      listDiv.style.transition = "none";
      listDiv.style.maxHeight = "";
      requestAnimationFrame(() => {
        setTimeout(() => {
          listDiv.style.transition = "";
        }, 0);
      });
    }

    headerDiv.addEventListener("click", event => {
      event.stopPropagation();
      if (state.collapsedFolders.has(folderName)) {
        state.collapsedFolders.delete(folderName);
        folderDiv.classList.remove("collapsed");
      } else {
        state.collapsedFolders.add(folderName);
        folderDiv.classList.add("collapsed");
      }
    });

    headerDiv.querySelector(".folder-delete-btn").addEventListener("click", async event => {
      event.stopPropagation();
      if (await ui.confirm(`确定要删除文件夹 "${folderName}" 吗？该文件夹下的模块将重归未分类。`)) {
        try {
          const response = await apiFetch("/api/folders", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: folderName })
          });

          if (!response.ok) throw new Error("Failed to delete folder");
          state.folders = state.folders.filter(folder => folder !== folderName);
          state.collapsedFolders.delete(folderName);
          await ctx.loadData();
        } catch (error) {
          console.error("Failed to delete folder: ", error);
          await ui.alert("❌ 删除文件夹失败。");
        }
      }
    });

    modules
      .filter(module => state.testCases.some(testCase => testCase.moduleId === module.moduleId && testCase.folderName === folderName))
      .forEach(module => {
        listDiv.appendChild(createModuleNavItem(ctx, module));
      });

    folderDiv.appendChild(headerDiv);
    folderDiv.appendChild(listDiv);
    foldersContainer.appendChild(folderDiv);
  });

  const unorganizedModules = modules.filter(module => {
    const caseItem = state.testCases.find(testCase => testCase.moduleId === module.moduleId);
    return !caseItem || !caseItem.folderName;
  });

  if (unorganizedModules.length > 0) {
    unorganizedTitle.style.display = "block";
    unorganizedModules.forEach(module => {
      unorganizedContainer.appendChild(createModuleNavItem(ctx, module));
    });
  } else {
    unorganizedTitle.style.display = "none";
  }

  initializeSidebarSortables(ctx);
  updateSidebarBadges();
}

function createFolderHeader(folderName) {
  const headerDiv = document.createElement("div");
  headerDiv.className = "folder-header";

  const leftSpan = document.createElement("span");
  leftSpan.className = "folder-header-left";

  const arrowSpan = document.createElement("span");
  arrowSpan.className = "folder-arrow";
  arrowSpan.textContent = "▼";

  const iconSpan = document.createElement("span");
  iconSpan.className = "folder-icon";
  iconSpan.textContent = "📁";

  const textSpan = document.createElement("span");
  textSpan.textContent = folderName;
  textSpan.style.whiteSpace = "nowrap";
  textSpan.style.overflow = "hidden";
  textSpan.style.textOverflow = "ellipsis";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "folder-delete-btn";
  deleteBtn.textContent = "✖";
  deleteBtn.title = "删除此文件夹";

  leftSpan.appendChild(arrowSpan);
  leftSpan.appendChild(iconSpan);
  leftSpan.appendChild(textSpan);
  headerDiv.appendChild(leftSpan);
  headerDiv.appendChild(deleteBtn);

  return headerDiv;
}

function createModuleNavItem(ctx, module) {
  const item = document.createElement("a");
  item.className = "menu-item";
  item.id = `nav-module-${module.moduleId}`;
  item.setAttribute("data-module-id", module.moduleId);
  item.setAttribute("draggable", "true");

  const leftSpan = document.createElement("span");
  leftSpan.className = "menu-item-left";

  const iconSpan = document.createElement("span");
  iconSpan.className = "menu-item-icon";
  iconSpan.textContent = "⚙️";

  const textSpan = document.createElement("span");
  textSpan.textContent = module.moduleName;
  textSpan.style.whiteSpace = "nowrap";
  textSpan.style.overflow = "hidden";
  textSpan.style.textOverflow = "ellipsis";
  textSpan.title = module.moduleName;

  const badge = document.createElement("span");
  badge.className = "menu-item-badge";
  badge.id = `badge-module-${module.moduleId}`;
  badge.textContent = "0";

  leftSpan.appendChild(iconSpan);
  leftSpan.appendChild(textSpan);
  item.appendChild(leftSpan);
  item.appendChild(badge);

  item.addEventListener("click", () => {
    ctx.switchView(module.moduleId);
  });

  if (state.currentModuleId === module.moduleId) {
    item.classList.add("active");
  }

  return item;
}

function initializeSidebarSortables(ctx) {
  if (!window.Sortable) return;

  new Sortable(ctx.els.foldersContainer, {
    group: "folders",
    animation: 150,
    handle: ".folder-header",
    ghostClass: "sortable-ghost",
    onEnd: async () => {
      const newFolderOrder = Array.from(ctx.els.foldersContainer.querySelectorAll(".sidebar-folder"))
        .map(element => element.getAttribute("data-folder-name"));
      state.folders = newFolderOrder;

      try {
        await apiFetch("/api/folders/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ names: newFolderOrder })
        });
      } catch (error) {
        console.error("Failed to sync folder reordering: ", error);
      }
    }
  });

  const handleModuleReorder = async event => {
    const moduleId = parseInt(event.item.getAttribute("data-module-id"), 10);

    if (event.from !== event.to) {
      const newFolderName = event.to.getAttribute("data-folder-name") || null;
      try {
        await apiFetch("/api/modules/folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId, folderName: newFolderName })
        });
        state.testCases
          .filter(testCase => testCase.moduleId === moduleId)
          .forEach(testCase => {
            testCase.folderName = newFolderName;
          });
        ctx.els.unorganizedTitle.style.display = ctx.els.unorganizedContainer.children.length > 0 ? "block" : "none";
      } catch (error) {
        console.error("Failed to associate module to new folder", error);
      }
    }

    const allModuleIds = Array.from(document.querySelectorAll(".menu-item[data-module-id]"))
      .map(element => parseInt(element.getAttribute("data-module-id"), 10));

    try {
      const response = await apiFetch("/api/modules/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleIds: allModuleIds })
      });
      if (response.ok) {
        allModuleIds.forEach((id, index) => {
          state.testCases
            .filter(testCase => testCase.moduleId === id)
            .forEach(testCase => {
              testCase.moduleSortOrder = index;
            });
        });
      }
    } catch (error) {
      console.error("Failed to reorder modules", error);
    }
  };

  document.querySelectorAll(".folder-modules-list").forEach(element => {
    new Sortable(element, {
      group: "modules",
      animation: 150,
      ghostClass: "sortable-ghost",
      onEnd: handleModuleReorder
    });
  });

  new Sortable(ctx.els.unorganizedContainer, {
    group: "modules",
    animation: 150,
    ghostClass: "sortable-ghost",
    onEnd: handleModuleReorder
  });
}

export function updateSidebarBadges() {
  getModules().forEach(module => {
    const badge = document.getElementById(`badge-module-${module.moduleId}`);
    if (!badge) return;

    const moduleCases = state.testCases.filter(testCase => testCase.moduleId === module.moduleId);
    const untestedCount = moduleCases.filter(testCase => testCase.status === "untested").length;
    badge.textContent = untestedCount;

    if (untestedCount === 0) {
      badge.style.backgroundColor = "var(--success)";
      badge.textContent = "✓";
    } else {
      badge.style.backgroundColor = "";
    }
  });
}

export function setupSidebarEvents(ctx) {
  const { btnAddFolder, btnCollapseAll } = ctx.els;

  if (btnAddFolder) {
    btnAddFolder.addEventListener("click", async () => {
      const folderName = await ui.prompt("请输入新建文件夹名称（如：回归测试、移动端、接口测试）：");
      if (folderName === null) return;

      const cleanName = folderName.trim();
      if (cleanName === "") {
        await ui.alert("文件夹名称不能为空！");
        return;
      }

      if (state.folders.includes(cleanName)) {
        await ui.alert("已存在同名文件夹！");
        return;
      }

      try {
        const response = await apiFetch("/api/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: cleanName })
        });
        if (!response.ok) throw new Error("Failed to create folder");

        state.folders.push(cleanName);
        renderSidebarModules(ctx);
      } catch (error) {
        console.error("Failed to create folder: ", error);
        await ui.alert("❌ 创建失败，请确认后台服务器连接正常。");
      }
    });
  }

  if (btnCollapseAll) {
    btnCollapseAll.addEventListener("click", () => {
      if (state.collapsedFolders.size < state.folders.length) {
        state.folders.forEach(folder => state.collapsedFolders.add(folder));
      } else {
        state.collapsedFolders.clear();
      }
      renderSidebarModules(ctx);
    });
  }
}
