import { apiFetch } from "../api.js";
import { state } from "../state.js";
import { ui } from "../ui.js";
import { escapeHtml, renderInlineMarkdown } from "../utils.js";
import { updateSidebarBadges } from "./sidebar.js";

export function renderModuleCases(ctx) {
  const { casesListContainer } = ctx.els;
  casesListContainer.innerHTML = "";

  const moduleCases = state.testCases
    .filter(testCase => testCase.moduleId === state.currentModuleId)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

  const filteredCases = moduleCases.filter(testCase => {
    if (state.currentFilter === "all") return true;
    return testCase.status === state.currentFilter;
  });

  if (filteredCases.length === 0) {
    casesListContainer.appendChild(createEmptyCasesMessage());
    return;
  }

  filteredCases.forEach(testCase => {
    casesListContainer.appendChild(createCaseCard(ctx, testCase));
  });

  initializeCaseSortable();
}

function createEmptyCasesMessage() {
  const emptyDiv = document.createElement("div");
  emptyDiv.style.textAlign = "center";
  emptyDiv.style.padding = "40px";
  emptyDiv.style.color = "var(--text-secondary)";
  emptyDiv.style.border = "1px dashed var(--border-color)";
  emptyDiv.style.borderRadius = "var(--radius-lg)";

  const emptyIcon = document.createElement("span");
  emptyIcon.style.fontSize = "2rem";
  emptyIcon.style.display = "block";
  emptyIcon.style.marginBottom = "12px";
  emptyIcon.textContent = "📁";

  emptyDiv.appendChild(emptyIcon);
  emptyDiv.appendChild(document.createTextNode("没有匹配到该状态下的测试用例"));
  return emptyDiv;
}

function createCaseCard(ctx, testCase) {
  const card = document.createElement("div");
  card.className = "case-card";
  card.id = `case-card-${testCase.id}`;

  const { badgeClass, statusText } = getStatusMeta(testCase.status);
  const safeCaseId = escapeHtml(testCase.id);
  const safeCaseTitle = escapeHtml(testCase.title);
  const safeStatusText = escapeHtml(statusText);
  const safeNotes = escapeHtml(testCase.notes || "");
  const steps = Array.isArray(testCase.steps) ? testCase.steps : [testCase.steps];
  const expected = Array.isArray(testCase.expected) ? testCase.expected : [testCase.expected];
  const stepsHTML = steps.map(step => `<li>${renderInlineMarkdown(step)}</li>`).join("");
  const expectedHTML = expected.map(result => `<li>${renderInlineMarkdown(result)}</li>`).join("");

  card.innerHTML = `
    <div class="case-card-header">
      <div class="case-info-left">
        <span class="case-id">${safeCaseId}</span>
        <span class="case-title">${safeCaseTitle}</span>
      </div>
      <div class="case-header-right">
        <span class="status-badge ${badgeClass}" id="badge-${safeCaseId}">${safeStatusText}</span>
        <span class="arrow-icon">▼</span>
      </div>
    </div>

    <div class="case-card-body">
      <div class="case-content-inner">
        <div class="case-detail-row">
          <span class="detail-label">前提条件</span>
          <div class="detail-content">${renderInlineMarkdown(testCase.precondition) || "无"}</div>
        </div>

        <div class="case-detail-row">
          <span class="detail-label">测试步骤</span>
          <div class="detail-content">
            <ol class="detail-list">${stepsHTML}</ol>
          </div>
        </div>

        <div class="case-detail-row">
          <span class="detail-label">预期结果</span>
          <div class="detail-content">
            <ul class="detail-list">${expectedHTML}</ul>
          </div>
        </div>

        <div class="case-action-row">
          <div class="status-trigger-group">
            <span class="detail-label">标记测试结果</span>
            <div class="btn-group">
              <button class="btn-status-set btn-set-passed ${testCase.status === "passed" ? "active" : ""}" data-status="passed">通过</button>
              <button class="btn-status-set btn-set-failed ${testCase.status === "failed" ? "active" : ""}" data-status="failed">不通过</button>
              <button class="btn-status-set btn-set-blocked ${testCase.status === "blocked" ? "active" : ""}" data-status="blocked">阻塞</button>
              <button class="btn-status-set btn-set-reset" data-status="untested">重置</button>
            </div>
          </div>

          <div class="notes-input-group">
            <span class="detail-label">执行备注 / 运行结果说明</span>
            <textarea class="notes-textarea" placeholder="在此记录实际输出日志、执行人、报错日志或测试数据...">${safeNotes}</textarea>
          </div>
        </div>
      </div>
    </div>
  `;

  card.querySelector(".case-card-header").addEventListener("click", () => {
    card.classList.toggle("expanded");
  });

  card.querySelectorAll(".btn-status-set").forEach(button => {
    button.addEventListener("click", () => {
      const newStatus = button.getAttribute("data-status");
      if (testCase.status === newStatus && newStatus !== "untested") {
        card.classList.remove("expanded");
        const nextCard = card.nextElementSibling;
        if (nextCard && nextCard.classList.contains("case-card")) {
          nextCard.classList.add("expanded");
          nextCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      updateCaseStatus(testCase.id, newStatus);
    });
  });

  card.querySelector(".notes-textarea").addEventListener("input", event => {
    updateCaseNotes(testCase.id, event.target.value);
  });

  return card;
}

function getStatusMeta(status) {
  if (status === "passed") return { badgeClass: "badge-passed", statusText: "已通过" };
  if (status === "failed") return { badgeClass: "badge-failed", statusText: "未通过" };
  if (status === "blocked") return { badgeClass: "badge-blocked", statusText: "已阻塞" };
  return { badgeClass: "badge-untested", statusText: "未测试" };
}

function initializeCaseSortable() {
  if (!window.Sortable) return;

  new Sortable(document.getElementById("cases-list-container"), {
    animation: 150,
    handle: ".case-card-header",
    ghostClass: "sortable-ghost",
    onEnd: async () => {
      const newOrderedIds = Array.from(document.querySelectorAll("#cases-list-container .case-card"))
        .map(element => element.id.replace("case-card-", ""));

      newOrderedIds.forEach((id, index) => {
        const item = state.testCases.find(testCase => testCase.id === id);
        if (item) item.sortOrder = index;
      });

      try {
        await apiFetch("/api/testcases/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: newOrderedIds })
        });
      } catch (error) {
        console.error("Failed to sync case reordering: ", error);
      }
    }
  });
}

async function updateCaseStatus(caseId, status) {
  const index = state.testCases.findIndex(testCase => testCase.id === caseId);
  if (index === -1) return;

  state.testCases[index].status = status;
  updateSidebarBadges();
  updateCaseStatusUI(caseId, status);

  try {
    const response = await apiFetch("/api/testcases/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: caseId, status })
    });
    if (!response.ok) throw new Error("HTTP status update sync failed");
  } catch (error) {
    console.error("Error syncing status update with database: ", error);
  }
}

function updateCaseStatusUI(caseId, status) {
  const card = document.getElementById(`case-card-${caseId}`);
  if (!card) return;

  card.querySelectorAll(".btn-status-set").forEach(button => {
    if (button.getAttribute("data-status") === status && status !== "untested") {
      button.classList.add("active");
    } else {
      button.classList.remove("active");
    }
  });

  const badge = document.getElementById(`badge-${caseId}`);
  if (!badge) return;

  const { badgeClass, statusText } = getStatusMeta(status);
  badge.className = `status-badge ${badgeClass}`;
  badge.textContent = statusText;
}

function updateCaseNotes(caseId, value) {
  const index = state.testCases.findIndex(testCase => testCase.id === caseId);
  if (index === -1) return;

  state.testCases[index].notes = value;
  clearTimeout(state.notesDebounceTimer);
  state.notesDebounceTimer = setTimeout(async () => {
    try {
      const response = await apiFetch("/api/testcases/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: caseId, notes: value })
      });
      if (!response.ok) throw new Error("HTTP notes update sync failed");
    } catch (error) {
      console.error("Error syncing notes with database: ", error);
    }
  }, 500);
}

export function setupCaseEvents(ctx) {
  const { btnResetModule, filterButtons } = ctx.els;

  if (btnResetModule) {
    btnResetModule.addEventListener("click", async () => {
      if (state.currentModuleId === null) {
        await ui.alert("请先在左侧选择一个功能模块！");
        return;
      }

      if (await ui.confirm("⚠️ 确定要重置当前模块的所有测试用例状态及备注吗？")) {
        try {
          const response = await apiFetch("/api/testcases/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moduleId: state.currentModuleId })
          });
          if (!response.ok) throw new Error("Database reset call failed");

          await ctx.loadData();
          await ui.alert("🧹 重置成功，当前模块测试数据已重置为未测试状态！");
        } catch (error) {
          console.error("Database reset error: ", error);
          await ui.alert("❌ 重置失败，请检查服务器网络。");
        }
      }
    });
  }

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      filterButtons.forEach(item => item.classList.remove("active"));
      button.classList.add("active");
      state.currentFilter = button.getAttribute("data-filter");
      renderModuleCases(ctx);
    });
  });
}
