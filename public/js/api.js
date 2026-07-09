import { state } from "./state.js";

export function apiFetch(url, options = {}) {
  let requestUrl = url;
  const requestOptions = { ...options };

  if (typeof requestUrl === "string" && requestUrl.startsWith("/api/") && state.currentProjectId) {
    const method = (requestOptions.method || "GET").toUpperCase();
    if (method === "GET") {
      const separator = requestUrl.includes("?") ? "&" : "?";
      requestUrl = `${requestUrl}${separator}projectId=${encodeURIComponent(state.currentProjectId)}`;
    } else if (requestOptions.body) {
      try {
        const bodyObj = JSON.parse(requestOptions.body);
        bodyObj.projectId = state.currentProjectId;
        requestOptions.body = JSON.stringify(bodyObj);
      } catch (error) {
        // Non-JSON API bodies are passed through unchanged.
      }
    }
  }

  return fetch(requestUrl, requestOptions);
}
