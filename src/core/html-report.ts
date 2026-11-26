import type { AnalysisResult } from './types.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeJsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function generateHtmlReport(result: AnalysisResult): string {
  const safeFileName = escapeHtml(result.fileName);
  const safeLang = escapeHtml(result.language);
  const payload = safeJsonForScript(result);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CogTrace X-Ray Report — ${safeFileName}</title>
<style>
  :root {
    --bg: #080b11;
    --panel: #101520;
    --panel-2: #151c2b;
    --border: rgba(148, 163, 184, 0.16);
    --text: #e2e8f0;
    --muted: #8b9bb4;
    --calm: #22d3ee;
    --moderate: #f59e0b;
    --high: #f97316;
    --overload: #f43f5e;
    --arc-read: #38bdf8;
    --arc-write: #fb923c;
    --arc-w2r: #f43f5e;
    --mono: ui-monospace, 'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace;
    --sans: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 14px;
    line-height: 1.5;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 20px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .brand-title {
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.02em;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 12px;
    font-family: var(--mono);
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--muted);
  }
  .grade {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    font-weight: 800;
    font-size: 17px;
  }
  .grade-A { background: rgba(34, 211, 238, 0.16); color: var(--calm); border: 1px solid rgba(34, 211, 238, 0.4); }
  .grade-B { background: rgba(56, 189, 248, 0.16); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); }
  .grade-C { background: rgba(245, 158, 11, 0.16); color: var(--moderate); border: 1px solid rgba(245, 158, 11, 0.4); }
  .grade-D { background: rgba(249, 115, 22, 0.16); color: var(--high); border: 1px solid rgba(249, 115, 22, 0.4); }
  .grade-F { background: rgba(244, 63, 94, 0.2); color: var(--overload); border: 1px solid rgba(244, 63, 94, 0.5); }

  .kpi-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
    gap: 10px;
    padding: 14px 20px;
    background: rgba(16, 21, 32, 0.7);
    border-bottom: 1px solid var(--border);
  }
  .kpi {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .kpi-val { font-family: var(--mono); font-size: 20px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .spark-wrap {
    padding: 10px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .spark-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
  .sparkline {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 30px;
    flex: 1;
    overflow: hidden;
  }
  .spark-bar {
    flex: 1;
    min-width: 2px;
    border-radius: 2px 2px 0 0;
    cursor: pointer;
    opacity: 0.85;
    transition: opacity 0.15s, transform 0.15s;
  }
  .spark-bar:hover { opacity: 1; transform: scaleY(1.08); }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 360px;
    min-height: calc(100vh - 180px);
  }
  @media (max-width: 960px) {
    .layout { grid-template-columns: 1fr; }
  }
  .code-panel {
    position: relative;
    overflow-x: auto;
    border-right: 1px solid var(--border);
    padding: 12px 0;
  }
  .code-stage {
    position: relative;
    display: flex;
    min-width: 640px;
  }
  .code-lines {
    flex: 1;
    min-width: 0;
  }
  .code-row {
    display: flex;
    align-items: center;
    height: 24px;
    font-family: var(--mono);
    font-size: 12.5px;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: background 0.1s;
    white-space: pre;
  }
  .code-row:hover { background: rgba(148, 163, 184, 0.09); }
  .code-row.active { background: rgba(56, 189, 248, 0.14); }
  .code-row.span-hl { background: rgba(244, 63, 94, 0.12); }
  .code-row.sev-calm { border-left-color: var(--calm); }
  .code-row.sev-moderate { border-left-color: var(--moderate); }
  .code-row.sev-high { border-left-color: var(--high); }
  .code-row.sev-overload { border-left-color: var(--overload); background: rgba(244, 63, 94, 0.06); }
  .ln {
    width: 44px;
    text-align: right;
    padding-right: 10px;
    color: var(--muted);
    user-select: none;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .slot-badge {
    width: 48px;
    text-align: center;
    font-size: 10.5px;
    font-weight: 700;
    border-radius: 4px;
    margin-right: 10px;
    padding: 1px 4px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .slot-calm { color: var(--calm); background: rgba(34, 211, 238, 0.1); }
  .slot-moderate { color: var(--moderate); background: rgba(245, 158, 11, 0.12); }
  .slot-high { color: var(--high); background: rgba(249, 115, 22, 0.15); }
  .slot-overload { color: #fff; background: var(--overload); }
  .code-text {
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 14px;
  }
  .arc-gutter {
    width: 150px;
    flex-shrink: 0;
    position: relative;
    border-left: 1px solid var(--border);
    background: rgba(8, 11, 17, 0.45);
  }
  .arc-gutter svg {
    display: block;
    width: 150px;
  }

  .hud {
    background: var(--panel);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }
  .hud-card {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .hud-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 10px 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .slot-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-bottom: 8px;
  }
  .slot-cell {
    flex: 1 1 32px;
    min-width: 32px;
    height: 26px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: rgba(8, 11, 17, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--muted);
    overflow: hidden;
    padding: 0 4px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slot-cell.filled { background: rgba(34, 211, 238, 0.18); border-color: rgba(34, 211, 238, 0.5); color: #e0f2fe; }
  .slot-cell.warn { background: rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.55); color: #fef3c7; }
  .slot-cell.over { background: rgba(244, 63, 94, 0.28); border-color: var(--overload); color: #ffe4e6; }
  .chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .var-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: 11.5px;
    cursor: pointer;
  }
  .var-chip.selected { border-color: var(--calm); box-shadow: 0 0 0 1px var(--calm); }
  .tag { font-size: 9.5px; padding: 1px 4px; border-radius: 3px; font-weight: 700; }
  .tag-mut { background: rgba(251, 146, 60, 0.2); color: #fdba74; }
  .tag-shd { background: rgba(244, 63, 94, 0.2); color: #fda4af; }
  .tag-cap { background: rgba(168, 85, 247, 0.2); color: #d8b4fe; }
  .hint-item {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 11px;
    margin-bottom: 8px;
    background: rgba(8, 11, 17, 0.5);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .hint-item:hover { border-color: var(--calm); }
  .hint-head { font-weight: 600; font-size: 12.5px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .dot-critical { background: var(--overload); }
  .dot-warning { background: var(--moderate); }
  .dot-info { background: var(--calm); }
  .hint-detail { font-size: 11.5px; color: var(--muted); }
  .legend { display: flex; gap: 12px; font-size: 11px; color: var(--muted); flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .swatch { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
</style>
</head>
<body>
<header class="header">
  <div class="brand">
    <span class="grade grade-${result.summary.grade}">${result.summary.grade}</span>
    <div>
      <div class="brand-title">CogTrace X-Ray Report</div>
      <div style="font-size:12px;color:var(--muted)">${safeFileName}</div>
    </div>
  </div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <span class="pill">${safeLang}</span>
    <span class="pill">Miller Limit: ${result.capacity} slots</span>
    <span class="pill">Click any line to pin eye-jump arcs</span>
  </div>
</header>

<section class="kpi-strip">
  <div class="kpi"><div class="kpi-label">Peak Slots</div><div class="kpi-val" style="color:${result.summary.peakSlots > result.capacity ? 'var(--overload)' : 'var(--calm)'}">${result.summary.peakSlots} / ${result.capacity}</div></div>
  <div class="kpi"><div class="kpi-label">Avg Load Score</div><div class="kpi-val">${result.summary.avgScore}</div></div>
  <div class="kpi"><div class="kpi-label">Max Line Score</div><div class="kpi-val">${result.summary.maxScore} <span style="font-size:11px;color:var(--muted)">L${result.summary.maxScoreLine}</span></div></div>
  <div class="kpi"><div class="kpi-label">Overload Lines</div><div class="kpi-val" style="color:${result.summary.overloadLines > 0 ? 'var(--overload)' : 'var(--calm)'}">${result.summary.overloadLines}</div></div>
  <div class="kpi"><div class="kpi-label">Max Eye-Jump</div><div class="kpi-val">${result.summary.maxJumpDistance}L</div></div>
  <div class="kpi"><div class="kpi-label">Mutations</div><div class="kpi-val">${result.summary.totalMutations}</div></div>
</section>

<div class="spark-wrap">
  <span class="spark-label">Cognitive Load Timeline</span>
  <div class="sparkline" id="sparkline"></div>
</div>

<main class="layout">
  <section class="code-panel">
    <div class="code-stage">
      <div class="code-lines" id="code-lines"></div>
      <div class="arc-gutter" id="arc-gutter"></div>
    </div>
  </section>

  <aside class="hud">
    <div class="hud-card" id="brain-hud"></div>
    <div class="hud-card">
      <div class="hud-title"><span>Arc Legend</span></div>
      <div class="legend">
        <span><i class="swatch" style="background:var(--arc-read)"></i>def → read</span>
        <span><i class="swatch" style="background:var(--arc-write)"></i>def → write</span>
        <span><i class="swatch" style="background:var(--arc-w2r)"></i>write → read</span>
      </div>
    </div>
    <div class="hud-card">
      <div class="hud-title"><span>Refactoring Hints (${result.hints.length})</span></div>
      <div id="hints-list"></div>
    </div>
  </aside>
</main>

<script>
const DATA = ${payload};
const ROW_H = 24;
const varMap = new Map(DATA.variables.map((v) => [v.id, v]));
let pinnedLine = DATA.summary.maxScoreLine || 1;
let hoverLine = null;
let isolatedVarId = null;
let highlightSpan = null;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sevColor(sev) {
  if (sev === 'overload') return '#f43f5e';
  if (sev === 'high') return '#f97316';
  if (sev === 'moderate') return '#f59e0b';
  return '#22d3ee';
}

function renderSparkline() {
  const el = document.getElementById('sparkline');
  const maxS = Math.max(10, DATA.summary.maxScore);
  el.innerHTML = DATA.lines.map((l) => {
    const h = Math.max(3, Math.round((Math.min(l.score, maxS) / maxS) * 28));
    return '<div class="spark-bar" data-line="' + l.line + '" title="L' + l.line + ' · Score ' + l.score + ' · ' + l.slotCount + '/' + DATA.capacity + ' slots" style="height:' + h + 'px;background:' + sevColor(l.severity) + '"></div>';
  }).join('');
  el.addEventListener('click', (e) => {
    const bar = e.target.closest('.spark-bar');
    if (!bar) return;
    const ln = Number(bar.dataset.line);
    pinnedLine = ln;
    isolatedVarId = null;
    updateActive();
    const row = document.querySelector('.code-row[data-line="' + ln + '"]');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function renderCodeLines() {
  const container = document.getElementById('code-lines');
  container.innerHTML = DATA.lines.map((l) => {
    const badge = l.slotCount + '/' + DATA.capacity + (l.overflow > 0 ? '!' : '');
    return '<div class="code-row sev-' + l.severity + '" data-line="' + l.line + '">' +
      '<span class="ln">' + l.line + '</span>' +
      '<span class="slot-badge slot-' + l.severity + '">' + badge + '</span>' +
      '<span class="code-text">' + esc(l.text || ' ') + '</span>' +
      '</div>';
  }).join('');

  container.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.code-row');
    if (!row) return;
    const ln = Number(row.dataset.line);
    if (hoverLine !== ln) {
      hoverLine = ln;
      updateActive();
    }
  });
  container.addEventListener('mouseleave', () => {
    hoverLine = null;
    updateActive();
  });
  container.addEventListener('click', (e) => {
    const row = e.target.closest('.code-row');
    if (!row) return;
    const ln = Number(row.dataset.line);
    pinnedLine = ln;
    isolatedVarId = null;
    highlightSpan = null;
    updateActive();
  });
}

function renderArcs(activeLine) {
  const gutter = document.getElementById('arc-gutter');
  const totalH = Math.max(ROW_H, DATA.lines.length * ROW_H);
  const lineObj = DATA.lines[activeLine - 1];
  const liveSet = new Set(lineObj ? lineObj.liveVars : []);

  const visibleArcs = DATA.arcs.filter((a) => {
    if (isolatedVarId) return a.varId === isolatedVarId;
    return a.toLine === activeLine || a.fromLine === activeLine || (liveSet.has(a.varId) && a.fromLine <= activeLine && a.toLine >= activeLine);
  }).slice(0, 28);

  const width = 150;
  let paths = '';
  const activeY = (activeLine - 0.5) * ROW_H;
  paths += '<line x1="0" y1="' + activeY + '" x2="' + width + '" y2="' + activeY + '" stroke="rgba(56,189,248,0.22)" stroke-dasharray="3 3" />';

  visibleArcs.forEach((arc, idx) => {
    const y1 = (arc.fromLine - 0.5) * ROW_H;
    const y2 = (arc.toLine - 0.5) * ROW_H;
    const direct = arc.toLine === activeLine || arc.fromLine === activeLine || isolatedVarId === arc.varId;
    const curveDepth = Math.min(width - 18, 22 + Math.sqrt(arc.distance) * 14 + (idx % 5) * 9);
    const color = arc.kind === 'write-to-read' ? '#f43f5e' : arc.kind === 'def-to-write' ? '#fb923c' : '#38bdf8';
    const opacity = direct ? 0.92 : 0.25;
    const strokeW = direct ? 1.9 : 1.1;
    paths += '<path d="M 4 ' + y1 + ' C ' + curveDepth + ' ' + y1 + ', ' + curveDepth + ' ' + y2 + ', 4 ' + y2 + '" fill="none" stroke="' + color + '" stroke-width="' + strokeW + '" opacity="' + opacity + '"><title>' + esc(arc.varName) + ': L' + arc.fromLine + ' -> L' + arc.toLine + ' (' + arc.kind + ', ' + arc.distance + 'L)</title></path>';
    if (direct) {
      paths += '<circle cx="4" cy="' + y1 + '" r="2.7" fill="' + color + '" />';
      paths += '<circle cx="4" cy="' + y2 + '" r="3.2" fill="' + color + '" />';
      if (arc.distance >= 4) {
        const midY = (y1 + y2) / 2;
        paths += '<text x="' + Math.min(width - 28, curveDepth * 0.78 + 4) + '" y="' + (midY + 3) + '" fill="' + color + '" font-size="9" font-family="monospace">' + arc.distance + 'L</text>';
      }
    }
  });

  gutter.innerHTML = '<svg width="' + width + '" height="' + totalH + '" viewBox="0 0 ' + width + ' ' + totalH + '">' + paths + '</svg>';
}

function renderBrainHud(activeLine) {
  const hud = document.getElementById('brain-hud');
  const l = DATA.lines[activeLine - 1];
  if (!l) return;

  const cap = DATA.capacity;
  const totalSlots = Math.max(cap, l.slotCount);
  let slotCells = '';
  for (let i = 0; i < totalSlots; i++) {
    const varId = l.liveVars[i];
    const v = varId ? varMap.get(varId) : null;
    let cls = 'slot-cell';
    if (v) {
      if (i >= cap) cls += ' over';
      else if (l.slotCount >= cap - 1) cls += ' warn';
      else cls += ' filled';
    }
    slotCells += '<div class="' + cls + '" title="' + (v ? esc(v.name) + ' (L' + v.defLine + '->L' + v.lastUseLine + ')' : 'Free slot') + '">' + (v ? esc(v.name) : '·') + '</div>';
  }

  const chips = l.liveVars.map((vid) => {
    const v = varMap.get(vid);
    if (!v) return '';
    const badges =
      (v.mutations.length > 0 ? '<span class="tag tag-mut">MUT×' + v.mutations.length + '</span>' : '') +
      (v.isShadowed ? '<span class="tag tag-shd">SHD</span>' : '') +
      (v.isCaptured ? '<span class="tag tag-cap">CAP</span>' : '');
    const sel = isolatedVarId === v.id ? ' selected' : '';
    return '<button class="var-chip' + sel + '" data-var="' + esc(v.id) + '" style="color:var(--text)">' +
      '<span>' + esc(v.name) + '</span>' +
      '<span style="color:var(--muted);font-size:10px">L' + v.defLine + '→' + v.lastUseLine + '</span>' +
      badges + '</button>';
  }).join('');

  hud.innerHTML =
    '<div class="hud-title"><span>Working-Memory HUD · Line ' + l.line + '</span><span style="color:' + sevColor(l.severity) + '">' + l.severity.toUpperCase() + ' (' + l.score + ')</span></div>' +
    '<div style="font-family:var(--mono);font-size:12px;margin-bottom:8px;color:' + (l.overflow > 0 ? 'var(--overload)' : 'var(--text)') + '">' +
    l.slotCount + ' / ' + cap + ' slots' + (l.overflow > 0 ? ' (+' + l.overflow + ' OVERFLOW)' : '') +
    ' · Nesting ' + l.nestingDepth + ' · Jump ' + l.maxJumpHere + 'L</div>' +
    '<div class="slot-grid">' + slotCells + '</div>' +
    '<div style="font-size:11px;color:var(--muted);margin:10px 0 6px">Live Variables (click chip to isolate arcs)</div>' +
    '<div class="chip-list">' + (chips || '<span style="font-size:12px;color:var(--muted)">No active bindings on this line</span>') + '</div>';

  hud.querySelectorAll('.var-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const vid = btn.dataset.var;
      isolatedVarId = isolatedVarId === vid ? null : vid;
      updateActive();
    });
  });
}

function renderHints() {
  const list = document.getElementById('hints-list');
  if (DATA.hints.length === 0) {
    list.innerHTML = '<div style="font-size:12px;color:var(--calm)">No cognitive load issues detected.</div>';
    return;
  }
  list.innerHTML = DATA.hints.map((h) =>
    '<div class="hint-item" data-start="' + h.startLine + '" data-end="' + h.endLine + '">' +
    '<div class="hint-head"><span class="dot dot-' + h.severity + '"></span><span>' + esc(h.title) + '</span></div>' +
    '<div class="hint-detail">' + esc(h.detail) + '</div>' +
    '<div class="hint-detail" style="color:#93c5fd;margin-top:4px">Tip: ' + esc(h.suggestion) + '</div>' +
    '</div>'
  ).join('');
  list.querySelectorAll('.hint-item').forEach((el) => {
    el.addEventListener('click', () => {
      const start = Number(el.dataset.start);
      const end = Number(el.dataset.end);
      pinnedLine = start;
      highlightSpan = { start, end };
      isolatedVarId = null;
      updateActive();
      const row = document.querySelector('.code-row[data-line="' + start + '"]');
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

function updateActive() {
  const activeLine = hoverLine || pinnedLine;
  document.querySelectorAll('.code-row').forEach((row) => {
    const ln = Number(row.dataset.line);
    row.classList.toggle('active', ln === activeLine);
    row.classList.toggle('span-hl', Boolean(highlightSpan && ln >= highlightSpan.start && ln <= highlightSpan.end));
  });
  renderArcs(activeLine);
  renderBrainHud(activeLine);
}

renderSparkline();
renderCodeLines();
renderHints();
updateActive();
</script>
</body>
</html>
`;
}
