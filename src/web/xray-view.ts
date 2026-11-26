import type { AnalysisResult, EyeJumpArc, Language, Severity, VariableLifecycle } from '../core/types.js';

export interface XRayViewOptions {
  compact?: boolean;
  onSelectLine?: (line: number) => void;
}

export interface XRayViewHandle {
  update(result: AnalysisResult): void;
  focusLine(line: number, scrollIntoView?: boolean): void;
  destroy(): void;
}

const ROW_HEIGHT = 24;
const ARC_LANE_WIDTH = 164;

const TS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface',
  'let', 'new', 'null', 'of', 'private', 'protected', 'public', 'readonly', 'return',
  'static', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'var', 'void', 'while'
]);

const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'case',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match', 'nonlocal', 'not',
  'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function severityColor(sev: Severity): string {
  switch (sev) {
    case 'overload': return '#f43f5e';
    case 'high': return '#f97316';
    case 'moderate': return '#f59e0b';
    case 'calm': return '#22d3ee';
  }
}

function arcColor(kind: EyeJumpArc['kind']): string {
  switch (kind) {
    case 'write-to-read': return '#f43f5e';
    case 'def-to-write': return '#fb923c';
    case 'def-to-read': return '#38bdf8';
  }
}

function highlightCodeLine(text: string, lang: Language): string {
  if (!text) return ' ';
  const keywords = lang === 'python' ? PY_KEYWORDS : TS_KEYWORDS;
  let out = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    // Comments
    if ((lang === 'python' && ch === '#') || (lang !== 'python' && ch === '/' && text[i + 1] === '/')) {
      out += `<span class="tok-cmt">${escapeHtml(text.slice(i))}</span>`;
      break;
    }

    // Strings
    if (ch === '"' || ch === "'" || (lang !== 'python' && ch === '`')) {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\' && j + 1 < text.length) {
          j += 2;
          continue;
        }
        if (text[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      out += `<span class="tok-str">${escapeHtml(text.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z0-9_$]/.test(text[i - 1]))) {
      let j = i;
      while (j < text.length && /[0-9._xXa-fA-F]/.test(text[j])) j++;
      out += `<span class="tok-num">${escapeHtml(text.slice(i, j))}</span>`;
      i = j;
      continue;
    }

    // Identifiers / Keywords
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_$]/.test(text[j])) j++;
      const word = text.slice(i, j);
      if (keywords.has(word)) {
        out += `<span class="tok-kw">${escapeHtml(word)}</span>`;
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }

    out += escapeHtml(ch);
    i++;
  }

  return out;
}

export function createXRayView(
  container: HTMLElement,
  options: XRayViewOptions = {}
): XRayViewHandle {
  const compact = Boolean(options.compact);
  let currentResult: AnalysisResult | null = null;
  let varMap = new Map<string, VariableLifecycle>();
  let pinnedLine = 1;
  let hoverLine: number | null = null;
  let isolatedVarId: string | null = null;
  let highlightSpan: { start: number; end: number } | null = null;
  let hotspotLines: number[] = [];

  const uid = `xray_${Math.random().toString(36).slice(2, 9)}`;

  container.innerHTML = `
    <div class="xray-shell ${compact ? 'xray-compact' : ''}">
      <div class="xray-spark-bar">
        <span class="xray-spark-label">Load Trace</span>
        <div class="xray-sparkline" data-role="sparkline"></div>
        <div class="xray-nav-group">
          <button type="button" class="mini-btn" data-role="prev-hotspot" title="Previous cognitive hotspot">◀ Hotspot</button>
          <button type="button" class="mini-btn" data-role="next-hotspot" title="Next cognitive hotspot">Hotspot ▶</button>
        </div>
      </div>

      <div class="xray-body">
        <div class="xray-code-scroll" data-role="code-scroll">
          <div class="xray-stage">
            <div class="xray-lines" data-role="code-lines"></div>
            <div class="xray-arcs" data-role="arc-gutter"></div>
          </div>
        </div>

        <aside class="xray-hud" data-role="hud">
          <div class="hud-card" data-role="brain-card"></div>
          <div class="hud-card hud-legend-card">
            <div class="hud-card-head">
              <span>Eye-Jump Arcs</span>
              <span class="hud-sub" data-role="arc-count">0 arcs</span>
            </div>
            <div class="arc-legend">
              <span><i class="swatch" style="background:#38bdf8"></i>def → read</span>
              <span><i class="swatch" style="background:#fb923c"></i>def → write</span>
              <span><i class="swatch" style="background:#f43f5e"></i>write → read</span>
            </div>
          </div>
          <div class="hud-card" data-role="hints-card"></div>
        </aside>
      </div>
    </div>
  `;

  const sparkEl = container.querySelector<HTMLElement>('[data-role="sparkline"]')!;
  const linesEl = container.querySelector<HTMLElement>('[data-role="code-lines"]')!;
  const arcsEl = container.querySelector<HTMLElement>('[data-role="arc-gutter"]')!;
  const brainCard = container.querySelector<HTMLElement>('[data-role="brain-card"]')!;
  const hintsCard = container.querySelector<HTMLElement>('[data-role="hints-card"]')!;
  const arcCountEl = container.querySelector<HTMLElement>('[data-role="arc-count"]')!;
  const prevBtn = container.querySelector<HTMLButtonElement>('[data-role="prev-hotspot"]')!;
  const nextBtn = container.querySelector<HTMLButtonElement>('[data-role="next-hotspot"]')!;

  function activeLineNum(): number {
    return hoverLine ?? pinnedLine;
  }

  function renderSparkline(result: AnalysisResult): void {
    const maxS = Math.max(10, result.summary.maxScore);
    sparkEl.innerHTML = result.lines
      .map((l) => {
        const h = Math.max(3, Math.round((Math.min(l.score, maxS) / maxS) * 26));
        return `<button type="button" class="spark-cell" data-line="${l.line}" title="L${l.line} · Score ${l.score} · ${l.slotCount}/${result.capacity} slots" style="height:${h}px;background:${severityColor(l.severity)}"></button>`;
      })
      .join('');
  }

  function renderCodeRows(result: AnalysisResult): void {
    linesEl.innerHTML = result.lines
      .map((l) => {
        const slotTxt = `${l.slotCount}/${result.capacity}${l.overflow > 0 ? '!' : ''}`;
        const cfDot = l.controlFlowJump
          ? `<span class="cf-pill" title="Control flow jump: ${escapeHtml(l.controlFlowKinds.join(', '))}">↵</span>`
          : '';
        return `<div class="code-row sev-${l.severity}" data-line="${l.line}">
          <span class="ln">${l.line}</span>
          <span class="slot-badge slot-${l.severity}">${slotTxt}</span>
          <span class="code-text">${highlightCodeLine(l.text, result.language)}${cfDot}</span>
        </div>`;
      })
      .join('');
  }

  function renderArcs(): void {
    if (!currentResult) return;
    const result = currentResult;
    const active = activeLineNum();
    const totalH = Math.max(ROW_HEIGHT, result.lines.length * ROW_HEIGHT);
    const lineObj = result.lines[active - 1];
    const liveSet = new Set(lineObj?.liveVars ?? []);

    const matchingArcs = result.arcs.filter((a) => {
      if (isolatedVarId) return a.varId === isolatedVarId;
      return (
        a.toLine === active ||
        a.fromLine === active ||
        (liveSet.has(a.varId) && a.fromLine <= active && a.toLine >= active)
      );
    });

    // Prioritize direct arcs to/from active line first
    matchingArcs.sort((a, b) => {
      const aDirect = a.toLine === active || a.fromLine === active || isolatedVarId === a.varId ? 1 : 0;
      const bDirect = b.toLine === active || b.fromLine === active || isolatedVarId === b.varId ? 1 : 0;
      if (aDirect !== bDirect) return bDirect - aDirect;
      return b.distance - a.distance;
    });

    const visible = matchingArcs.slice(0, 32);
    const directCount = visible.filter(
      (a) => a.toLine === active || a.fromLine === active || isolatedVarId === a.varId
    ).length;
    arcCountEl.textContent = isolatedVarId
      ? `${visible.length} isolated`
      : `${directCount} direct · ${visible.length} active`;

    const activeY = (active - 0.5) * ROW_HEIGHT;
    const filterId = `glow_${uid}`;
    const svgParts: string[] = [
      `<defs>
        <filter id="${filterId}" x="-20%" y="-10%" width="150%" height="120%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>`,
      `<line x1="0" y1="${activeY}" x2="${ARC_LANE_WIDTH}" y2="${activeY}" stroke="rgba(56, 189, 248, 0.25)" stroke-width="1" stroke-dasharray="3 3" />`,
      `<circle cx="6" cy="${activeY}" r="3.4" fill="#38bdf8" opacity="0.9" />`
    ];

    // Draw background arcs first, then foreground direct arcs on top
    const ordered = [...visible].reverse();
    ordered.forEach((arc, idx) => {
      const y1 = (arc.fromLine - 0.5) * ROW_HEIGHT;
      const y2 = (arc.toLine - 0.5) * ROW_HEIGHT;
      const isDirect =
        isolatedVarId !== null
          ? arc.varId === isolatedVarId
          : arc.toLine === active || arc.fromLine === active;

      const spread = Math.min(
        ARC_LANE_WIDTH - 22,
        24 + Math.sqrt(arc.distance) * 15 + (idx % 6) * 8
      );
      const color = arcColor(arc.kind);
      const opacity = isDirect ? 0.94 : 0.2;
      const strokeWidth = isDirect ? 2.0 : 1.05;
      const filterAttr = isDirect ? ` filter="url(#${filterId})"` : '';

      const d = `M 6 ${y1} C ${spread} ${y1}, ${spread} ${y2}, 6 ${y2}`;
      const title = `${escapeHtml(arc.varName)}: L${arc.fromLine} → L${arc.toLine} (${arc.kind}, ${arc.distance}L)`;

      svgParts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}" stroke-linecap="round"${filterAttr}><title>${title}</title></path>`
      );

      if (isDirect) {
        // Origin marker (hollow for def, solid for write)
        if (arc.kind === 'write-to-read') {
          svgParts.push(`<rect x="3.5" y="${y1 - 2.5}" width="5" height="5" transform="rotate(45 6 ${y1})" fill="${color}" />`);
        } else {
          svgParts.push(`<circle cx="6" cy="${y1}" r="3" fill="#070a10" stroke="${color}" stroke-width="1.6" />`);
        }
        // Destination marker
        svgParts.push(`<circle cx="6" cy="${y2}" r="3.2" fill="${color}" />`);

        // Distance label near apex of Bezier
        if (arc.distance >= 3) {
          const midY = (y1 + y2) / 2;
          const apexX = Math.min(ARC_LANE_WIDTH - 34, 6 + (spread - 6) * 0.76);
          svgParts.push(
            `<g>
              <rect x="${apexX - 2}" y="${midY - 7}" width="32" height="13" rx="3" fill="#0c1220" stroke="${color}" stroke-opacity="0.45" stroke-width="0.8" />
              <text x="${apexX + 14}" y="${midY + 2.5}" text-anchor="middle" fill="${color}" font-size="8.5" font-family="ui-monospace, monospace" font-weight="700">Δ${arc.distance}L</text>
            </g>`
          );
        }
      }
    });

    arcsEl.innerHTML = `<svg width="${ARC_LANE_WIDTH}" height="${totalH}" viewBox="0 0 ${ARC_LANE_WIDTH} ${totalH}" aria-label="Eye-jump arcs">${svgParts.join('')}</svg>`;
  }

  function renderBrainHud(): void {
    if (!currentResult) return;
    const result = currentResult;
    const active = activeLineNum();
    const l = result.lines[active - 1];
    if (!l) return;

    const cap = result.capacity;
    const cellCount = Math.max(cap, l.slotCount);
    let cellsHtml = '';
    for (let i = 0; i < cellCount; i++) {
      const vid = l.liveVars[i];
      const v = vid ? varMap.get(vid) : null;
      let cls = 'wm-slot';
      if (v) {
        if (i >= cap) cls += ' wm-slot-over';
        else if (l.slotCount >= cap) cls += ' wm-slot-high';
        else if (l.slotCount >= Math.max(4, cap - 2)) cls += ' wm-slot-warn';
        else cls += ' wm-slot-ok';
      }
      const selected = v && isolatedVarId === v.id ? ' wm-slot-sel' : '';
      cellsHtml += `<div class="${cls}${selected}" ${v ? `data-var="${escapeHtml(v.id)}"` : ''} title="${v ? `${escapeHtml(v.name)} (L${v.defLine} → L${v.lastUseLine})` : 'Empty working-memory slot'}">${v ? escapeHtml(v.name) : '·'}</div>`;
    }

    const overflowBadge =
      l.overflow > 0
        ? `<span class="overflow-pill">+${l.overflow} OVERFLOW</span>`
        : `<span class="capacity-ok">within ${cap}-slot limit</span>`;

    const chipsHtml = l.liveVars
      .map((vid) => {
        const v = varMap.get(vid);
        if (!v) return '';
        const tags =
          (v.mutations.length > 0 ? `<span class="vtag vtag-mut">MUT×${v.mutations.length}</span>` : '') +
          (v.isShadowed ? `<span class="vtag vtag-shd">SHADOW</span>` : '') +
          (v.isCaptured ? `<span class="vtag vtag-cap">CLOSURE</span>` : '');
        const sel = isolatedVarId === v.id ? ' selected' : '';
        return `<button type="button" class="var-chip${sel}" data-var="${escapeHtml(v.id)}" title="Click to isolate eye-jump arcs for ${escapeHtml(v.name)}">
          <span class="var-chip-name">${escapeHtml(v.name)}</span>
          <span class="var-chip-span">L${v.defLine}→${v.lastUseLine}</span>
          ${tags}
        </button>`;
      })
      .join('');

    const pinLabel = hoverLine !== null && hoverLine !== pinnedLine ? 'Previewing' : 'Pinned';

    brainCard.innerHTML = `
      <div class="hud-card-head">
        <span>Working-Memory HUD · <strong>L${l.line}</strong></span>
        <span class="sev-pill sev-pill-${l.severity}">${l.severity.toUpperCase()} · ${l.score}</span>
      </div>
      <div class="wm-summary-row">
        <span class="wm-count">${l.slotCount}/${cap} slots</span>
        ${overflowBadge}
        <span class="pin-state">${pinLabel}</span>
      </div>
      <div class="wm-slot-grid">${cellsHtml}</div>
      <div class="line-telemetry">
        <span>Nesting <strong>${l.nestingDepth}</strong></span>
        <span>Max Jump <strong>${l.maxJumpHere}L</strong></span>
        <span>Writes <strong>${l.mutationCount}</strong></span>
        <span>CF Jump <strong>${l.controlFlowJump ? l.controlFlowKinds.join(',') : 'none'}</strong></span>
      </div>
      <div class="chip-section-head">
        <span>Live Variables (${l.liveVars.length})</span>
        ${isolatedVarId ? `<button type="button" class="clear-iso-btn" data-role="clear-iso">Show all arcs</button>` : `<span class="hud-sub">click chip to isolate</span>`}
      </div>
      <div class="var-chip-list">
        ${chipsHtml || '<span class="empty-note">Working memory is clear on this line.</span>'}
      </div>
    `;

    brainCard.querySelectorAll<HTMLElement>('[data-var]').forEach((el) => {
      el.addEventListener('click', () => {
        const vid = el.dataset.var ?? null;
        isolatedVarId = isolatedVarId === vid ? null : vid;
        syncActiveState();
      });
    });

    const clearIsoBtn = brainCard.querySelector<HTMLButtonElement>('[data-role="clear-iso"]');
    clearIsoBtn?.addEventListener('click', () => {
      isolatedVarId = null;
      syncActiveState();
    });
  }

  function renderHints(result: AnalysisResult): void {
    const visibleHints = compact ? result.hints.slice(0, 4) : result.hints;
    const itemsHtml =
      visibleHints.length === 0
        ? `<div class="empty-note calm-note">✓ Zero cognitive load alerts — clean working-memory profile.</div>`
        : visibleHints
            .map(
              (h) => `
          <button type="button" class="hint-card" data-start="${h.startLine}" data-end="${h.endLine}">
            <div class="hint-head">
              <span class="hint-dot hint-dot-${h.severity}"></span>
              <span class="hint-title">${escapeHtml(h.title)}</span>
            </div>
            <div class="hint-detail">${escapeHtml(h.detail)}</div>
            <div class="hint-tip">${escapeHtml(h.suggestion)}</div>
          </button>`
            )
            .join('');

    hintsCard.innerHTML = `
      <div class="hud-card-head">
        <span>Refactoring Hints</span>
        <span class="hud-sub">${result.hints.length} found</span>
      </div>
      <div class="hint-list">${itemsHtml}</div>
    `;

    hintsCard.querySelectorAll<HTMLButtonElement>('.hint-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        const start = Number(btn.dataset.start);
        const end = Number(btn.dataset.end);
        pinnedLine = start;
        hoverLine = null;
        isolatedVarId = null;
        highlightSpan = { start, end };
        syncActiveState();
        scrollToLine(start);
        options.onSelectLine?.(start);
      });
    });
  }

  function scrollToLine(line: number): void {
    const row = linesEl.querySelector<HTMLElement>(`.code-row[data-line="${line}"]`);
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function syncActiveState(): void {
    const active = activeLineNum();
    linesEl.querySelectorAll<HTMLElement>('.code-row').forEach((row) => {
      const ln = Number(row.dataset.line);
      row.classList.toggle('is-active', ln === active);
      row.classList.toggle('is-pinned', ln === pinnedLine);
      row.classList.toggle(
        'is-span-hl',
        Boolean(highlightSpan && ln >= highlightSpan.start && ln <= highlightSpan.end)
      );
    });
    renderArcs();
    renderBrainHud();
  }

  // Event listeners
  linesEl.addEventListener('mousemove', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.code-row');
    if (!row) return;
    const ln = Number(row.dataset.line);
    if (hoverLine !== ln) {
      hoverLine = ln;
      syncActiveState();
    }
  });

  linesEl.addEventListener('mouseleave', () => {
    if (hoverLine !== null) {
      hoverLine = null;
      syncActiveState();
    }
  });

  linesEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.code-row');
    if (!row) return;
    const ln = Number(row.dataset.line);
    pinnedLine = ln;
    highlightSpan = null;
    isolatedVarId = null;
    syncActiveState();
    options.onSelectLine?.(ln);
  });

  sparkEl.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.spark-cell');
    if (!cell) return;
    const ln = Number(cell.dataset.line);
    pinnedLine = ln;
    hoverLine = null;
    highlightSpan = null;
    isolatedVarId = null;
    syncActiveState();
    scrollToLine(ln);
    options.onSelectLine?.(ln);
  });

  function jumpHotspot(dir: -1 | 1): void {
    if (hotspotLines.length === 0) return;
    const current = pinnedLine;
    let target = hotspotLines[0];
    if (dir === 1) {
      target = hotspotLines.find((l) => l > current) ?? hotspotLines[0];
    } else {
      const prevs = hotspotLines.filter((l) => l < current);
      target = prevs.length > 0 ? prevs[prevs.length - 1] : hotspotLines[hotspotLines.length - 1];
    }
    pinnedLine = target;
    hoverLine = null;
    isolatedVarId = null;
    highlightSpan = null;
    syncActiveState();
    scrollToLine(target);
  }

  prevBtn.addEventListener('click', () => jumpHotspot(-1));
  nextBtn.addEventListener('click', () => jumpHotspot(1));

  return {
    update(result: AnalysisResult): void {
      currentResult = result;
      varMap = new Map(result.variables.map((v) => [v.id, v]));
      hotspotLines = result.lines
        .filter((l) => l.severity === 'overload' || l.severity === 'high')
        .map((l) => l.line);
      if (hotspotLines.length === 0 && result.lines.length > 0) {
        hotspotLines = [result.summary.maxScoreLine || 1];
      }

      // Keep pinned line valid, or jump to max hotspot on fresh load / out-of-bounds
      if (pinnedLine < 1 || pinnedLine > result.lines.length || pinnedLine === 1) {
        pinnedLine = result.summary.maxScoreLine || 1;
      }
      hoverLine = null;
      isolatedVarId = null;
      highlightSpan = null;

      renderSparkline(result);
      renderCodeRows(result);
      renderHints(result);
      syncActiveState();
    },
    focusLine(line: number, doScroll = true): void {
      if (!currentResult) return;
      pinnedLine = Math.max(1, Math.min(currentResult.lines.length, line));
      hoverLine = null;
      syncActiveState();
      if (doScroll) scrollToLine(pinnedLine);
    },
    destroy(): void {
      container.innerHTML = '';
    }
  };
}
