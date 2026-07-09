import { apiFetch } from "../api.js";
import { ui } from "../ui.js";

export async function loadBackups(ctx) {
  const { backupListTbody } = ctx.els;
  if (!backupListTbody) return;

  backupListTbody.innerHTML = "<tr><td colspan='4'>加载中...</td></tr>";

  try {
    const response = await apiFetch("/api/backups");
    const files = await response.json();

    backupListTbody.innerHTML = "";
    if (files.length === 0) {
      backupListTbody.innerHTML = "<tr><td colspan='4' style='text-align: center; color: var(--text-secondary);'>暂无备份记录</td></tr>";
      return;
    }

    files.forEach(fileInfo => {
      backupListTbody.appendChild(createBackupRow(fileInfo));
    });

    bindBackupRowActions(ctx);
  } catch (error) {
    console.error(error);
    backupListTbody.innerHTML = "<tr><td colspan='4' style='color: red;'>加载备份失败</td></tr>";
  }
}

function createBackupRow(fileInfo) {
  const row = document.createElement("tr");
  const dateObj = new Date(fileInfo.createdAt);
  const sizeMb = `${(fileInfo.size / (1024 * 1024)).toFixed(2)} MB`;

  const nameCell = document.createElement("td");
  nameCell.style.fontFamily = "monospace";
  nameCell.textContent = fileInfo.name;

  const dateCell = document.createElement("td");
  dateCell.textContent = dateObj.toLocaleString();

  const sizeCell = document.createElement("td");
  sizeCell.textContent = sizeMb;

  const actionCell = document.createElement("td");
  actionCell.className = "backup-actions-cell";

  const restoreBtn = createBackupButton("btn btn-primary btn-restore-backup", "恢复", fileInfo.name);
  const downloadBtn = createBackupButton("btn btn-secondary btn-download-backup", "下载", fileInfo.name);
  const deleteBtn = createBackupButton("btn btn-secondary btn-delete-backup", "删除", fileInfo.name);
  deleteBtn.style.color = "var(--danger-color)";

  actionCell.appendChild(restoreBtn);
  actionCell.appendChild(downloadBtn);
  actionCell.appendChild(deleteBtn);

  row.appendChild(nameCell);
  row.appendChild(dateCell);
  row.appendChild(sizeCell);
  row.appendChild(actionCell);

  return row;
}

function createBackupButton(className, text, fileName) {
  const button = document.createElement("button");
  button.className = className;
  button.setAttribute("data-file", fileName);
  button.textContent = text;
  button.style.padding = "4px 8px";
  button.style.fontSize = "0.85rem";
  return button;
}

function bindBackupRowActions(ctx) {
  document.querySelectorAll(".btn-download-backup").forEach(button => {
    button.addEventListener("click", event => {
      const file = event.target.getAttribute("data-file");
      window.open(`/api/backups/download/${file}`, "_blank");
    });
  });

  document.querySelectorAll(".btn-delete-backup").forEach(button => {
    button.addEventListener("click", async event => {
      const file = event.target.getAttribute("data-file");
      if (await ui.confirm(`⚠️ 确定要删除备份 ${file} 吗？\n删除后无法找回！`)) {
        const response = await apiFetch(`/api/backups/${file}`, { method: "DELETE" });
        if (response.ok) {
          loadBackups(ctx);
        } else {
          ui.alert("❌ 删除失败");
        }
      }
    });
  });

  document.querySelectorAll(".btn-restore-backup").forEach(button => {
    button.addEventListener("click", async event => {
      const file = event.target.getAttribute("data-file");
      if (await ui.confirm(`⚠️ 高能预警：您即将把整个数据库回滚至 ${file} 的状态！\n\n系统会自动先创建一个覆盖前的“后悔药”快照，以防万一。\n请确认是否继续回滚？`)) {
        try {
          const response = await apiFetch("/api/backups/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file })
          });
          const data = await response.json();
          if (response.ok) {
            await ui.alert("✅ 数据库恢复成功！\n请等待页面刷新以重新加载全部数据。");
            window.location.reload();
          } else {
            ui.alert(`❌ 恢复失败：${data.error}`);
          }
        } catch (error) {
          ui.alert("❌ 网络或服务器错误，恢复失败。");
        }
      }
    });
  });
}

export function setupBackupEvents(ctx) {
  const { btnBackupMgmt, btnCreateBackup } = ctx.els;

  if (btnBackupMgmt) {
    btnBackupMgmt.addEventListener("click", () => {
      ctx.switchView("backup");
    });
  }

  if (btnCreateBackup) {
    btnCreateBackup.addEventListener("click", async () => {
      try {
        const response = await apiFetch("/api/backups", { method: "POST" });
        const data = await response.json();
        if (data.success) {
          await ui.alert(`✅ 备份创建成功：\n${data.fileName}`);
          loadBackups(ctx);
        } else {
          await ui.alert(`❌ 备份失败：${data.error}`);
        }
      } catch (error) {
        await ui.alert(`❌ 请求失败：${error.message}`);
      }
    });
  }
}
