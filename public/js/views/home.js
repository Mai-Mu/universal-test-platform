import { apiFetch } from "../api.js";
import { state } from "../state.js";
import { ui } from "../ui.js";

export async function loadProjects(ctx) {
  try {
    const response = await apiFetch("/api/projects");
    if (response.ok) {
      renderProjects(ctx, await response.json());
    }
  } catch (error) {
    console.error("Failed to load projects", error);
  }
}

function renderProjects(ctx, projects) {
  const { projectsGrid } = ctx.els;
  if (!projectsGrid) return;
  projectsGrid.innerHTML = "";

  projects.forEach(project => {
    const card = document.createElement("div");
    card.className = "project-card";

    const icon = document.createElement("div");
    icon.className = "project-icon";
    icon.textContent = "📁";

    const title = document.createElement("h3");
    title.className = "project-title";
    title.textContent = project.name;

    const desc = document.createElement("p");
    desc.className = "project-desc";
    desc.textContent = project.description || "无描述";

    const meta = document.createElement("div");
    meta.className = "project-meta";
    meta.textContent = `创建于: ${new Date(project.created_at).toLocaleDateString()}`;

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(meta);

    card.addEventListener("click", () => {
      ctx.openProject(project.id, project.name);
    });

    projectsGrid.appendChild(card);
  });
}

export function setupHomeEvents(ctx) {
  const { btnCreateProject, btnBackHome } = ctx.els;

  if (btnCreateProject) {
    btnCreateProject.addEventListener("click", async () => {
      const name = await ui.prompt("请输入新项目名称：");
      if (!name || !name.trim()) return;
      const desc = await ui.prompt("请输入项目描述（选填）：");

      try {
        const response = await apiFetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), description: desc || "" })
        });
        if (response.ok) {
          ctx.loadProjects();
        } else {
          await ui.alert("❌ 创建项目失败，可能存在同名项目。");
        }
      } catch (error) {
        console.error("Failed to create project", error);
        await ui.alert("❌ 网络或服务器错误。");
      }
    });
  }

  if (btnBackHome) {
    btnBackHome.addEventListener("click", () => {
      state.currentProjectId = null;
      ctx.els.workspaceView.style.display = "none";
      ctx.els.homeView.style.display = "flex";
      ctx.loadProjects();
    });
  }
}
