import {
  DEFAULT_WM_CAPACITY,
  analyzeCode,
  compareRefactor,
  generateHtmlReport,
  type AnalysisResult,
  type DiffComparison,
  type Language
} from '../core/index.js';
import { EXAMPLES, type CodeExample } from './examples.js';
import { createXRayView, type XRayViewHandle } from './xray-view.js';

type ActiveTab = 'single' | 'arena';
type SingleLayout = 'split' | 'xray' | 'editor';

interface AppState {
  tab: ActiveTab;
  singleLayout: SingleLayout;
  exampleId: string;
  language: Language;
  capacity: number;
  fileName: string;
  singleCode: string;

  arenaExampleId: string;
  arenaLanguage: Language;
  arenaBeforeCode: string;
  arenaAfterCode: string;
  arenaBeforeEditing: boolean;
  arenaAfterEditing: boolean;
}

const ARENA_EXAMPLES = EXAMPLES.filter((e) => Boolean(e.refactoredCode));

function getExample(id: string): CodeExample {
  return EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
}

function enableTabIndent(textarea: HTMLTextAreaElement): void {
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = `${textarea.value.slice(0, start)}  ${textarea.value.slice(end)}`;
    textarea.selectionStart = textarea.selectionEnd = start + 2;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadFile(fileName: string, content: string, mime = 'text/html;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initApp(): void {
  const root = document.getElementById('app');
  if (!root) return;

  const initialSingle = EXAMPLES[0];
  const initialArena = ARENA_EXAMPLES[0];

  const state: AppState = {
    tab: 'single',
    singleLayout: 'split',
    exampleId: initialSingle.id,
    language: initialSingle.language,
    capacity: DEFAULT_WM_CAPACITY,
    fileName: initialSingle.fileName,
    singleCode: initialSingle.code,

    arenaExampleId: initialArena.id,
    arenaLanguage: initialArena.language,
    arenaBeforeCode: initialArena.code,
    arenaAfterCode: initialArena.refactoredCode ?? '',
    arenaBeforeEditing: false,
    arenaAfterEditing: false
  };

  root.innerHTML = `
    <header class="topbar">
      <div class="brand-group">
        <div class="brand-logo" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M5 4 C19 4, 19 20, 5 20" stroke="#22d3ee" stroke-width="2.2" stroke-linecap="round"/>
            <path d="M5 9 C14 9, 14 15, 5 15" stroke="#f43f5e" stroke-width="2.1" stroke-linecap="round"/>
            <circle cx="5" cy="4" r="2.2" fill="#22d3ee"/>
            <circle cx="5" cy="20" r="2.2" fill="#22d3ee"/>
            <circle cx="5" cy="9" r="2" fill="#f43f5e"/>
            <circle cx="5" cy="15" r="2" fill="#f43f5e"/>
          </svg>
        </div>
        <div>
          <div class="brand-name">
            CogTrace <span class="brand-version">v0.1.0</span>
          </div>
          <div class="brand-sub">Working-Memory Cognitive Load Simulator &amp; Eye-Jump Visualizer</div>
        </div>
      </div>

      <nav class="mode-tabs" role="tablist" aria-label="Workspace mode">
        <button type="button" class="mode-tab active" data-tab="single" role="tab" aria-selected="true">
          Single File X-Ray
        </button>
        <button type="button" class="mode-tab" data-tab="arena" role="tab" aria-selected="false">
          Before / After Refactor Arena
        </button>
      </nav>

      <div class="topbar-actions">
        <button type="button" class="btn btn-primary" id="btn-export-html">
          Export HTML Report
        </button>
        <a
          class="btn"
          href="https://github.com/xnezerxx/cogtrace"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
      </div>
    </header>

    <!-- TAB 1: SINGLE FILE X-RAY -->
    <section id="panel-single" style="display:flex;flex-direction:column;flex:1">
      <div class="control-bar">
        <div class="control-group">
          <label class="ctrl-field">
            Preset
            <select id="single-preset" class="ctrl-select">
              ${EXAMPLES.map(
                (ex) => `<option value="${ex.id}">${escapeHtml(ex.title)}</option>`
              ).join('')}
            </select>
          </label>
          <label class="ctrl-field">
            Language
            <select id="single-lang" class="ctrl-select">
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
          </label>
          <label class="ctrl-field">
            Miller Capacity
            <select id="single-cap" class="ctrl-select">
              <option value="5">5 slots (Strict)</option>
              <option value="7" selected>7 slots (Miller 7±2)</option>
              <option value="9">9 slots (Expert)</option>
            </select>
          </label>
        </div>

        <div class="control-group">
          <div class="segmented" role="group" aria-label="View layout">
            <button type="button" class="seg-btn active" data-layout="split">Split Edit + X-Ray</button>
            <button type="button" class="seg-btn" data-layout="xray">X-Ray Focus</button>
            <button type="button" class="seg-btn" data-layout="editor">Editor Only</button>
          </div>
        </div>
      </div>

      <div class="kpi-strip" id="single-kpis"></div>

      <div class="single-workspace layout-split" id="single-workspace">
        <div class="editor-pane">
          <div class="pane-header">
            <span class="pane-title" id="single-editor-file">${escapeHtml(state.fileName)}</span>
            <span>Live AST · paste any TS / JS / Python</span>
          </div>
          <textarea
            id="single-editor"
            class="code-editor"
            spellcheck="false"
            aria-label="Source code editor"
          ></textarea>
        </div>
        <div class="xray-pane" id="single-xray-mount"></div>
      </div>
    </section>

    <!-- TAB 2: BEFORE / AFTER REFACTOR ARENA -->
    <section id="panel-arena" class="arena-shell hidden">
      <div class="control-bar">
        <div class="control-group">
          <label class="ctrl-field">
            Refactor Pair
            <select id="arena-preset" class="ctrl-select">
              ${ARENA_EXAMPLES.map(
                (ex) => `<option value="${ex.id}">${escapeHtml(ex.title)} → Refactored</option>`
              ).join('')}
            </select>
          </label>
          <label class="ctrl-field">
            Language
            <select id="arena-lang" class="ctrl-select">
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
          </label>
          <label class="ctrl-field">
            Miller Capacity
            <select id="arena-cap" class="ctrl-select">
              <option value="5">5 slots (Strict)</option>
              <option value="7" selected>7 slots (Miller 7±2)</option>
              <option value="9">9 slots (Expert)</option>
            </select>
          </label>
        </div>
        <div class="control-group">
          <span class="brand-sub">Click "Edit Code" on either side to test your own refactor live</span>
        </div>
      </div>

      <div class="delta-banner" id="arena-delta"></div>

      <div class="arena-grid">
        <div class="arena-col">
          <div class="arena-col-head">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="arena-tag arena-tag-before">BEFORE</span>
              <span class="pane-title" id="arena-before-title"></span>
            </div>
            <button type="button" class="mini-btn" id="btn-toggle-before-edit">Edit Code</button>
          </div>
          <div class="arena-editor-wrap hidden" id="arena-before-editor-wrap">
            <textarea id="arena-before-editor" class="code-editor" spellcheck="false" aria-label="Before refactor code"></textarea>
          </div>
          <div id="arena-before-xray"></div>
        </div>

        <div class="arena-col">
          <div class="arena-col-head">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="arena-tag arena-tag-after">AFTER</span>
              <span class="pane-title" id="arena-after-title"></span>
            </div>
            <button type="button" class="mini-btn" id="btn-toggle-after-edit">Edit Code</button>
          </div>
          <div class="arena-editor-wrap hidden" id="arena-after-editor-wrap">
            <textarea id="arena-after-editor" class="code-editor" spellcheck="false" aria-label="After refactor code"></textarea>
          </div>
          <div id="arena-after-xray"></div>
        </div>
      </div>
    </section>
  `;

  // DOM References
  const panelSingle = document.getElementById('panel-single')!;
  const panelArena = document.getElementById('panel-arena')!;
  const singlePreset = document.getElementById('single-preset') as HTMLSelectElement;
  const singleLang = document.getElementById('single-lang') as HTMLSelectElement;
  const singleCap = document.getElementById('single-cap') as HTMLSelectElement;
  const singleEditor = document.getElementById('single-editor') as HTMLTextAreaElement;
  const singleEditorFile = document.getElementById('single-editor-file')!;
  const singleKpis = document.getElementById('single-kpis')!;
  const singleWorkspace = document.getElementById('single-workspace')!;
  const singleXRayMount = document.getElementById('single-xray-mount')!;
  const exportBtn = document.getElementById('btn-export-html') as HTMLButtonElement;

  const arenaPreset = document.getElementById('arena-preset') as HTMLSelectElement;
  const arenaLang = document.getElementById('arena-lang') as HTMLSelectElement;
  const arenaCap = document.getElementById('arena-cap') as HTMLSelectElement;
  const arenaDelta = document.getElementById('arena-delta')!;
  const arenaBeforeTitle = document.getElementById('arena-before-title')!;
  const arenaAfterTitle = document.getElementById('arena-after-title')!;
  const arenaBeforeEditWrap = document.getElementById('arena-before-editor-wrap')!;
  const arenaAfterEditWrap = document.getElementById('arena-after-editor-wrap')!;
  const arenaBeforeEditor = document.getElementById('arena-before-editor') as HTMLTextAreaElement;
  const arenaAfterEditor = document.getElementById('arena-after-editor') as HTMLTextAreaElement;
  const btnToggleBeforeEdit = document.getElementById('btn-toggle-before-edit') as HTMLButtonElement;
  const btnToggleAfterEdit = document.getElementById('btn-toggle-after-edit') as HTMLButtonElement;
  const arenaBeforeMount = document.getElementById('arena-before-xray')!;
  const arenaAfterMount = document.getElementById('arena-after-xray')!;

  enableTabIndent(singleEditor);
  enableTabIndent(arenaBeforeEditor);
  enableTabIndent(arenaAfterEditor);

  const singleXRay: XRayViewHandle = createXRayView(singleXRayMount, { compact: false });
  const beforeXRay: XRayViewHandle = createXRayView(arenaBeforeMount, { compact: true });
  const afterXRay: XRayViewHandle = createXRayView(arenaAfterMount, { compact: true });

  let latestSingleResult: AnalysisResult | null = null;
  let latestArenaDiff: DiffComparison | null = null;

  function renderSingleKpis(res: AnalysisResult): void {
    const s = res.summary;
    const peakColor = s.peakSlots > res.capacity ? 'var(--overload)' : 'var(--calm)';
    const overColor = s.overloadLines > 0 ? 'var(--overload)' : 'var(--calm)';

    singleKpis.innerHTML = `
      <div class="grade-card">
        <div class="grade-badge grade-${s.grade}">${s.grade}</div>
        <div>
          <div class="kpi-label">Cognitive Grade</div>
          <div class="kpi-sub">${s.totalVariables} bindings · ${s.codeLines} lines</div>
        </div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Peak WM Slots</div>
        <div class="kpi-value" style="color:${peakColor}">${s.peakSlots} / ${res.capacity}</div>
        <div class="kpi-sub">peak at L${s.peakSlotsLine} · avg ${s.avgSlots}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Avg Load Score</div>
        <div class="kpi-value">${s.avgScore}</div>
        <div class="kpi-sub">max ${s.maxScore} at L${s.maxScoreLine}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Overload Lines</div>
        <div class="kpi-value" style="color:${overColor}">${s.overloadLines}</div>
        <div class="kpi-sub">${s.highLines} high-pressure lines</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Max Eye-Jump</div>
        <div class="kpi-value">${s.maxJumpDistance}L</div>
        <div class="kpi-sub">${res.arcs.length} trace arcs</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">State Mutations</div>
        <div class="kpi-value">${s.totalMutations}</div>
        <div class="kpi-sub">${s.shadowedCount} shadowed · ${s.capturedCount} closures</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Max Nesting</div>
        <div class="kpi-value">${s.maxNestingDepth}</div>
        <div class="kpi-sub">${s.controlFlowJumps} CF jumps · ${res.hints.length} hints</div>
      </div>
    `;
  }

  function runSingleAnalysis(): void {
    const res = analyzeCode(state.singleCode, {
      fileName: state.fileName,
      language: state.language,
      capacity: state.capacity
    });
    latestSingleResult = res;
    renderSingleKpis(res);
    singleXRay.update(res);
  }

  function deltaClass(val: number): string {
    if (val < 0) return 'delta-good';
    if (val > 0) return 'delta-bad';
    return 'delta-flat';
  }

  function fmtSigned(val: number, suffix = ''): string {
    if (val === 0) return `0${suffix}`;
    return `${val > 0 ? '+' : ''}${val}${suffix}`;
  }

  function renderArenaDelta(diff: DiffComparison): void {
    const b = diff.before.summary;
    const a = diff.after.summary;
    const verdictText =
      diff.verdict === 'improved'
        ? `▼ ${Math.abs(diff.improvementPct)}% Cognitive Load`
        : diff.verdict === 'regressed'
          ? `▲ +${Math.abs(diff.improvementPct)}% Cognitive Load`
          : 'No Net Load Change';

    arenaDelta.innerHTML = `
      <div class="delta-hero">
        <span class="delta-verdict verdict-${diff.verdict}">${verdictText}</span>
        <div>
          <div style="font-weight:700;font-size:13.5px">Grade ${b.grade} → ${a.grade}</div>
          <div class="brand-sub">Avg Score ${b.avgScore} → ${a.avgScore} (${fmtSigned(diff.avgScoreDelta)})</div>
        </div>
      </div>
      <div class="delta-metrics">
        <div class="delta-pill">
          <span class="delta-pill-label">Peak WM Slots</span>
          <span class="delta-pill-val ${deltaClass(diff.peakSlotsDelta)}">${b.peakSlots} → ${a.peakSlots} (${fmtSigned(diff.peakSlotsDelta)})</span>
        </div>
        <div class="delta-pill">
          <span class="delta-pill-label">Overload Lines</span>
          <span class="delta-pill-val ${deltaClass(diff.overloadLinesDelta)}">${b.overloadLines} → ${a.overloadLines} (${fmtSigned(diff.overloadLinesDelta)})</span>
        </div>
        <div class="delta-pill">
          <span class="delta-pill-label">Max Eye-Jump</span>
          <span class="delta-pill-val ${deltaClass(diff.maxJumpDelta)}">${b.maxJumpDistance}L → ${a.maxJumpDistance}L (${fmtSigned(diff.maxJumpDelta, 'L')})</span>
        </div>
        <div class="delta-pill">
          <span class="delta-pill-label">Mutations</span>
          <span class="delta-pill-val ${deltaClass(diff.mutationsDelta)}">${b.totalMutations} → ${a.totalMutations} (${fmtSigned(diff.mutationsDelta)})</span>
        </div>
        <div class="delta-pill">
          <span class="delta-pill-label">Refactor Hints</span>
          <span class="delta-pill-val ${deltaClass(diff.hintsDelta)}">${diff.before.hints.length} → ${diff.after.hints.length} (${fmtSigned(diff.hintsDelta)})</span>
        </div>
      </div>
    `;
  }

  function runArenaAnalysis(): void {
    const ex = getExample(state.arenaExampleId);
    const diff = compareRefactor(state.arenaBeforeCode, state.arenaAfterCode, state.arenaLanguage, {
      capacity: state.capacity
    });
    diff.before.fileName = ex.fileName;
    diff.after.fileName = ex.refactoredFileName ?? `refactored-${ex.fileName}`;
    latestArenaDiff = diff;

    arenaBeforeTitle.textContent = `${diff.before.fileName} · Grade ${diff.before.summary.grade} · Peak ${diff.before.summary.peakSlots}/${state.capacity}`;
    arenaAfterTitle.textContent = `${diff.after.fileName} · Grade ${diff.after.summary.grade} · Peak ${diff.after.summary.peakSlots}/${state.capacity}`;

    renderArenaDelta(diff);
    beforeXRay.update(diff.before);
    afterXRay.update(diff.after);
  }

  // Debounce helper for silky live typing
  let singleTimer: number | undefined;
  let arenaTimer: number | undefined;

  function scheduleSingle(): void {
    window.clearTimeout(singleTimer);
    singleTimer = window.setTimeout(runSingleAnalysis, 80);
  }

  function scheduleArena(): void {
    window.clearTimeout(arenaTimer);
    arenaTimer = window.setTimeout(runArenaAnalysis, 90);
  }

  // Tab switching
  root.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.dataset.tab as ActiveTab;
      state.tab = target;
      root.querySelectorAll<HTMLButtonElement>('.mode-tab').forEach((b) => {
        const active = b.dataset.tab === target;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', String(active));
      });
      panelSingle.classList.toggle('hidden', target !== 'single');
      panelArena.classList.toggle('hidden', target !== 'arena');
      if (target === 'arena') {
        runArenaAnalysis();
      } else {
        runSingleAnalysis();
      }
    });
  });

  // Single layout toggle
  root.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const layout = btn.dataset.layout as SingleLayout;
      state.singleLayout = layout;
      root.querySelectorAll<HTMLButtonElement>('[data-layout]').forEach((b) => {
        b.classList.toggle('active', b.dataset.layout === layout);
      });
      singleWorkspace.classList.remove('layout-split', 'layout-xray', 'layout-editor');
      singleWorkspace.classList.add(`layout-${layout}`);
    });
  });

  // Single preset/lang/cap/editor bindings
  singlePreset.addEventListener('change', () => {
    const ex = getExample(singlePreset.value);
    state.exampleId = ex.id;
    state.language = ex.language;
    state.fileName = ex.fileName;
    state.singleCode = ex.code;
    singleLang.value = ex.language;
    singleEditor.value = ex.code;
    singleEditorFile.textContent = ex.fileName;
    runSingleAnalysis();
  });

  singleLang.addEventListener('change', () => {
    state.language = singleLang.value as Language;
    runSingleAnalysis();
  });

  singleCap.addEventListener('change', () => {
    state.capacity = Number(singleCap.value);
    arenaCap.value = singleCap.value;
    runSingleAnalysis();
  });

  singleEditor.addEventListener('input', () => {
    state.singleCode = singleEditor.value;
    scheduleSingle();
  });

  // Arena controls
  arenaPreset.addEventListener('change', () => {
    const ex = getExample(arenaPreset.value);
    state.arenaExampleId = ex.id;
    state.arenaLanguage = ex.language;
    state.arenaBeforeCode = ex.code;
    state.arenaAfterCode = ex.refactoredCode ?? ex.code;
    arenaLang.value = ex.language;
    arenaBeforeEditor.value = state.arenaBeforeCode;
    arenaAfterEditor.value = state.arenaAfterCode;
    runArenaAnalysis();
  });

  arenaLang.addEventListener('change', () => {
    state.arenaLanguage = arenaLang.value as Language;
    runArenaAnalysis();
  });

  arenaCap.addEventListener('change', () => {
    state.capacity = Number(arenaCap.value);
    singleCap.value = arenaCap.value;
    runArenaAnalysis();
  });

  btnToggleBeforeEdit.addEventListener('click', () => {
    state.arenaBeforeEditing = !state.arenaBeforeEditing;
    arenaBeforeEditWrap.classList.toggle('hidden', !state.arenaBeforeEditing);
    btnToggleBeforeEdit.textContent = state.arenaBeforeEditing ? 'Hide Editor' : 'Edit Code';
  });

  btnToggleAfterEdit.addEventListener('click', () => {
    state.arenaAfterEditing = !state.arenaAfterEditing;
    arenaAfterEditWrap.classList.toggle('hidden', !state.arenaAfterEditing);
    btnToggleAfterEdit.textContent = state.arenaAfterEditing ? 'Hide Editor' : 'Edit Code';
  });

  arenaBeforeEditor.addEventListener('input', () => {
    state.arenaBeforeCode = arenaBeforeEditor.value;
    scheduleArena();
  });

  arenaAfterEditor.addEventListener('input', () => {
    state.arenaAfterCode = arenaAfterEditor.value;
    scheduleArena();
  });

  // Export standalone HTML report
  exportBtn.addEventListener('click', () => {
    const targetResult =
      state.tab === 'arena' && latestArenaDiff ? latestArenaDiff.before : latestSingleResult;
    if (!targetResult) return;
    const html = generateHtmlReport(targetResult);
    const safeSlug = targetResult.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
    downloadFile(`cogtrace-${safeSlug}.html`, html);
  });

  // Initial hydration
  singleEditor.value = state.singleCode;
  singleLang.value = state.language;
  arenaBeforeEditor.value = state.arenaBeforeCode;
  arenaAfterEditor.value = state.arenaAfterCode;
  arenaLang.value = state.arenaLanguage;

  runSingleAnalysis();
}

initApp();
