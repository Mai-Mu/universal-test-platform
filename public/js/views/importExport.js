import { apiFetch } from "../api.js";
import { state } from "../state.js";
import { ui } from "../ui.js";
import { csvCell, downloadText } from "../utils.js";

export function setupImportExportEvents(ctx) {
  const { btnExportJson, btnExportCsv, btnImportJson, importFileInput } = ctx.els;

  btnExportJson.addEventListener("click", () => {
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadText(
      `test_platform_progress_${timestamp}.json`,
      JSON.stringify(state.testCases, null, 2),
      "application/json;charset=utf-8"
    );
  });

  btnExportCsv.addEventListener("click", () => {
    const timestamp = new Date().toISOString().slice(0, 10);
    let csvContent = "\uFEFF";
    csvContent += "功能模块,归属文件夹,用例编号,用例名称,测试状态,执行备注/实际输出\n";

    state.testCases.forEach(testCase => {
      let statusText = "未测试";
      if (testCase.status === "passed") statusText = "已通过";
      else if (testCase.status === "failed") statusText = "未通过";
      else if (testCase.status === "blocked") statusText = "已阻塞";

      csvContent += [
        csvCell(testCase.moduleName),
        csvCell(testCase.folderName || "未分类"),
        csvCell(testCase.id),
        csvCell(testCase.title),
        csvCell(statusText),
        csvCell(testCase.notes || "")
      ].join(",");
      csvContent += "\n";
    });

    downloadText(`test_platform_report_${timestamp}.csv`, csvContent, "text/csv;charset=utf-8");
  });

  btnImportJson.addEventListener("click", () => {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async loadEvent => {
      try {
        const imported = JSON.parse(loadEvent.target.result);
        if (!Array.isArray(imported)) {
          await ui.alert("❌ 导入失败：文件数据格式不正确，应为 JSON 数组。");
          return;
        }

        let matchedCount = 0;
        btnImportJson.textContent = "⏳ 同步中...";
        btnImportJson.disabled = true;

        for (const impItem of imported) {
          const target = state.testCases.find(testCase => testCase.id === impItem.id);
          if (!target) continue;

          await apiFetch("/api/testcases/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: impItem.id, status: impItem.status || "untested" })
          });

          await apiFetch("/api/testcases/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: impItem.id, notes: impItem.notes || "" })
          });

          if (impItem.folderName !== undefined) {
            if (impItem.folderName && !state.folders.includes(impItem.folderName)) {
              await apiFetch("/api/folders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: impItem.folderName })
              });
            }

            await apiFetch("/api/modules/folder", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ moduleId: target.moduleId, folderName: impItem.folderName })
            });
          }

          matchedCount += 1;
        }

        await ctx.loadData();
        ctx.switchView(state.currentModuleId);
        await ui.alert(`📥 SQLite 同步成功！已从备份还原了 ${matchedCount} 项用例进度及分类。`);
      } catch (error) {
        console.error("Import error: ", error);
        await ui.alert("❌ 导入失败：解析 JSON 文件并同步数据库时出错。");
      } finally {
        btnImportJson.textContent = "📥 导入进度";
        btnImportJson.disabled = false;
        importFileInput.value = "";
      }
    };

    reader.readAsText(file);
  });
}
