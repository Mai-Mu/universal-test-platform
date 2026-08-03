import { apiFetch } from "../api.js";

export async function renderProjectDocs(ctx) {
  const { projectDocsList, projectDocsEmpty } = ctx.els;
  projectDocsList.innerHTML = "";

  try {
    const response = await apiFetch("/api/project-documents");
    if (!response.ok) throw new Error("Failed to load project documents");
    const sections = await response.json();
    projectDocsEmpty.hidden = sections.length > 0;
    sections.forEach(section => projectDocsList.appendChild(renderSection(section)));
  } catch (error) {
    console.error("Failed to render project documents:", error);
    projectDocsEmpty.hidden = false;
    projectDocsEmpty.querySelector("strong").textContent = "项目说明加载失败";
    projectDocsEmpty.querySelector("span").textContent = "请稍后刷新页面重试。";
  }
}

function renderSection(section) {
  const article = document.createElement("article");
  article.className = "project-doc-section";

  const heading = document.createElement("h3");
  heading.textContent = section.title;
  article.appendChild(heading);
  article.appendChild(renderMarkdown(section.content));
  return article;
}

function renderMarkdown(markdown) {
  const root = document.createElement("div");
  root.className = "project-doc-content";
  const lines = String(markdown || "").split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    if (line.startsWith("|")) {
      const tableLines = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      root.appendChild(renderTable(tableLines));
      continue;
    }

    if (/^\d+\.\s/.test(line) || /^[-*]\s/.test(line)) {
      const ordered = /^\d+\.\s/.test(line);
      const list = document.createElement(ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = lines[index].trim();
        const match = item.match(ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!match) break;
        const li = document.createElement("li");
        appendInline(li, match[1]);
        list.appendChild(li);
        index += 1;
      }
      root.appendChild(list);
      continue;
    }

    if (line.startsWith(">")) {
      const quote = document.createElement("blockquote");
      appendInline(quote, line.replace(/^>\s?/, ""));
      root.appendChild(quote);
      index += 1;
      continue;
    }

    const subheading = line.match(/^#{2,4}\s+(.+)$/);
    if (subheading) {
      const heading = document.createElement("h4");
      appendInline(heading, subheading[1]);
      root.appendChild(heading);
      index += 1;
      continue;
    }

    const paragraph = document.createElement("p");
    appendInline(paragraph, line);
    root.appendChild(paragraph);
    index += 1;
  }
  return root;
}

function renderTable(lines) {
  const wrapper = document.createElement("div");
  wrapper.className = "project-doc-table-wrap";
  const table = document.createElement("table");
  const rows = lines.map(line => line.slice(1, -1).split("|").map(cell => cell.trim()));
  const bodyRows = rows.filter((_, index) => index !== 1 || !rows[index].every(cell => /^:?-{3,}:?$/.test(cell)));
  bodyRows.forEach((cells, rowIndex) => {
    const tr = document.createElement("tr");
    cells.forEach(cell => {
      const element = document.createElement(rowIndex === 0 ? "th" : "td");
      appendInline(element, cell);
      tr.appendChild(element);
    });
    table.appendChild(tr);
  });
  wrapper.appendChild(table);
  return wrapper;
}

function appendInline(parent, value) {
  const parts = String(value).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach(part => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = part.slice(2, -2);
      parent.appendChild(strong);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}
