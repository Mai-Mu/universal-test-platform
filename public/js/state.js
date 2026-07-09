export const state = {
  testCases: [],
  folders: [],
  collapsedFolders: new Set(),
  currentModuleId: null,
  currentFilter: "all",
  notesDebounceTimer: null,
  currentProjectId: null,
  currentProjectName: "测试总览"
};

export function getModules() {
  const modulesMap = new Map();
  state.testCases.forEach(testCase => {
    if (!modulesMap.has(testCase.moduleId)) {
      modulesMap.set(testCase.moduleId, {
        moduleId: testCase.moduleId,
        moduleName: testCase.moduleName,
        folderName: testCase.folderName,
        moduleSortOrder: testCase.moduleSortOrder || 0
      });
    }
  });

  return Array.from(modulesMap.values())
    .sort((a, b) => a.moduleSortOrder - b.moduleSortOrder);
}
