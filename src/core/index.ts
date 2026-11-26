export * from './types.js';
export { parseTypeScriptOrJavaScript } from './parser-ts.js';
export { parsePython } from './parser-py.js';
export {
  DEFAULT_WM_CAPACITY,
  analyzeCode,
  compareRefactor,
  detectLanguageFromFileName,
  simulateCognitiveLoad
} from './simulator.js';
export { generateHtmlReport } from './html-report.js';
