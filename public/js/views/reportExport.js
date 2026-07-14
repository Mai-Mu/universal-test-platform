import { buildStandaloneReport } from "../reportBuilder.mjs";
import { state } from "../state.js";
import { downloadText } from "../utils.js";

export function setupReportExportEvents(ctx) {
  ctx.els.btnExportHtmlReport?.addEventListener("click", () => {
    const generatedAt = new Date();
    const reportHtml = buildStandaloneReport({
      projectName: state.currentProjectName,
      testCases: state.testCases,
      folderOrder: state.folders,
      generatedAt
    });
    const projectName = safeFilenameSegment(state.currentProjectName || "测试项目");
    const date = generatedAt.toISOString().slice(0, 10);

    downloadText(
      `${projectName}_测试数据报告_${date}.html`,
      reportHtml,
      "text/html;charset=utf-8"
    );
  });
}

function safeFilenameSegment(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "测试项目";
}
