import type { AnalysisResult, DiffComparison, LineMetrics, Severity } from '../core/types.js';

export interface FormatOptions {
  color?: boolean;
  topHotspots?: number;
  topHints?: number;
}

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

class Ansi {
  constructor(private readonly enabled: boolean) {}
  private wrap(code: string, text: string): string {
    return this.enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
  }
  bold(s: string): string { return this.wrap('1', s); }
  dim(s: string): string { return this.wrap('2', s); }
  cyan(s: string): string { return this.wrap('36', s); }
  green(s: string): string { return this.wrap('32', s); }
  yellow(s: string): string { return this.wrap('33', s); }
  orange(s: string): string { return this.wrap('38;5;208', s); }
  red(s: string): string { return this.wrap('31', s); }
  magenta(s: string): string { return this.wrap('35', s); }
  bgRed(s: string): string { return this.wrap('41;37;1', s); }
  bgGreen(s: string): string { return this.wrap('42;30;1', s); }

  severity(sev: Severity, s: string): string {
    switch (sev) {
      case 'overload': return this.red(s);
      case 'high': return this.orange(s);
      case 'moderate': return this.yellow(s);
      case 'calm': return this.cyan(s);
    }
  }

  grade(g: AnalysisResult['summary']['grade']): string {
    switch (g) {
      case 'A': return this.bold(this.cyan(`[${g}]`));
      case 'B': return this.bold(this.green(`[${g}]`));
      case 'C': return this.bold(this.yellow(`[${g}]`));
      case 'D': return this.bold(this.orange(`[${g}]`));
      case 'F': return this.bgRed(` ${g} `);
    }
  }
}

export function renderSparkline(
  lines: LineMetrics[],
  maxScore: number,
  color = true,
  maxWidth = 64
): string {
  const ansi = new Ansi(color);
  if (lines.length === 0) return '';
  const scale = Math.max(10, maxScore);

  // Downsample if file has more lines than maxWidth by taking max severity/score per bucket
  const buckets: LineMetrics[] = [];
  if (lines.length <= maxWidth) {
    buckets.push(...lines);
  } else {
    const step = lines.length / maxWidth;
    for (let i = 0; i < maxWidth; i++) {
      const start = Math.floor(i * step);
      const end = Math.min(lines.length, Math.max(start + 1, Math.floor((i + 1) * step)));
      let worst = lines[start];
      for (let j = start + 1; j < end; j++) {
        if (lines[j].score > worst.score) worst = lines[j];
      }
      buckets.push(worst);
    }
  }

  return buckets
    .map((l) => {
      const ratio = Math.min(1, l.score / scale);
      const idx = Math.min(SPARK_CHARS.length - 1, Math.floor(ratio * SPARK_CHARS.length));
      return ansi.severity(l.severity, SPARK_CHARS[idx]);
    })
    .join('');
}

export function renderSlotGauge(slots: number, capacity: number, color = true): string {
  const ansi = new Ansi(color);
  const filledBase = Math.min(slots, capacity);
  const emptyBase = Math.max(0, capacity - filledBase);
  const overflow = Math.max(0, slots - capacity);

  const filledStr = '■'.repeat(filledBase);
  const emptyStr = '·'.repeat(emptyBase);
  const coloredFilled =
    overflow > 0
      ? ansi.red(filledStr)
      : slots >= capacity
        ? ansi.orange(filledStr)
        : slots >= Math.max(4, capacity - 2)
          ? ansi.yellow(filledStr)
          : ansi.cyan(filledStr);

  const base = `[${coloredFilled}${ansi.dim(emptyStr)}]`;
  if (overflow > 0) {
    return `${base} ${ansi.red(ansi.bold(`+${overflow} OVERFLOW`))}`;
  }
  return base;
}

export function formatAnalysisReport(
  result: AnalysisResult,
  opts: FormatOptions = {}
): string {
  const color = opts.color ?? true;
  const topHotspots = opts.topHotspots ?? 5;
  const topHints = opts.topHints ?? 5;
  const ansi = new Ansi(color);
  const s = result.summary;

  const out: string[] = [];
  out.push(
    `${ansi.bold(result.fileName)} ${ansi.dim(`(${result.language}, ${s.codeLines} code lines)`)}  Grade ${ansi.grade(s.grade)}`
  );
  out.push(
    `  WM Peak:  ${renderSlotGauge(s.peakSlots, result.capacity, color)}  ${ansi.bold(`${s.peakSlots}/${result.capacity}`)} slots ${ansi.dim(`(at L${s.peakSlotsLine})`)}`
  );
  out.push(
    `  Score:    avg ${ansi.bold(String(s.avgScore))} · max ${ansi.bold(String(s.maxScore))} ${ansi.dim(`(L${s.maxScoreLine})`)} · overload lines: ${s.overloadLines > 0 ? ansi.red(String(s.overloadLines)) : ansi.cyan('0')}`
  );
  out.push(
    `  Metrics:  max jump ${ansi.bold(`${s.maxJumpDistance}L`)} · mutations ${ansi.bold(String(s.totalMutations))} · shadowed ${ansi.bold(String(s.shadowedCount))} · closures ${ansi.bold(String(s.capturedCount))} · nesting ${ansi.bold(String(s.maxNestingDepth))}`
  );
  out.push(`  Trace:    ${renderSparkline(result.lines, s.maxScore, color)}`);

  const hotspots = [...result.lines]
    .filter((l) => l.text.trim().length > 0 && l.score > 0)
    .sort((a, b) => b.score - a.score || b.slotCount - a.slotCount)
    .slice(0, topHotspots);

  if (hotspots.length > 0) {
    out.push(`  ${ansi.bold('Top Hotspots:')}`);
    for (const h of hotspots) {
      const slotLabel = `${h.slotCount}/${result.capacity}${h.overflow > 0 ? '!' : ''}`.padEnd(6);
      const lineTag = `L${h.line}`.padEnd(5);
      const scoreTag = `${h.score.toFixed(1)}`.padStart(5);
      const snippet = h.text.trim().slice(0, 52);
      const livePreview = h.liveVarNames.slice(0, 5).join(', ') + (h.liveVarNames.length > 5 ? ', …' : '');
      out.push(
        `    ${ansi.severity(h.severity, lineTag)} ${ansi.severity(h.severity, slotLabel)} score ${ansi.bold(scoreTag)}  ${snippet}`
      );
      if (livePreview) {
        out.push(`      ${ansi.dim(`live: ${livePreview}`)}`);
      }
    }
  }

  if (result.hints.length > 0) {
    out.push(`  ${ansi.bold(`Top Refactoring Hints (${result.hints.length} total):`)}`);
    for (const hint of result.hints.slice(0, topHints)) {
      const icon =
        hint.severity === 'critical'
          ? ansi.red('✖')
          : hint.severity === 'warning'
            ? ansi.yellow('▲')
            : ansi.cyan('ℹ');
      out.push(`    ${icon} ${hint.title}`);
      out.push(`      ${ansi.dim(hint.suggestion)}`);
    }
  } else {
    out.push(`  ${ansi.cyan('✓ Clean working-memory footprint — no refactoring hotspots detected.')}`);
  }

  return out.join('\n');
}

export interface CheckViolation {
  fileName: string;
  reasons: string[];
  result: AnalysisResult;
}

export function formatCheckReport(
  results: AnalysisResult[],
  violations: CheckViolation[],
  thresholds: { maxSlots?: number; maxScore?: number; maxAvgScore?: number },
  color = true
): string {
  const ansi = new Ansi(color);
  const out: string[] = [];
  const limits: string[] = [];
  if (thresholds.maxSlots !== undefined) limits.push(`max-slots <= ${thresholds.maxSlots}`);
  if (thresholds.maxScore !== undefined) limits.push(`max-score <= ${thresholds.maxScore}`);
  if (thresholds.maxAvgScore !== undefined) limits.push(`max-avg-score <= ${thresholds.maxAvgScore}`);

  out.push(ansi.bold(`CogTrace Quality Gate (${limits.join(', ')})`));
  out.push('');

  const violMap = new Map(violations.map((v) => [v.fileName, v]));
  for (const r of results) {
    const v = violMap.get(r.fileName);
    const badge = v ? ansi.bgRed(' FAIL ') : ansi.bgGreen(' PASS ');
    const s = r.summary;
    out.push(
      `  ${badge} ${r.fileName}  ${ansi.dim(`slots=${s.peakSlots}/${r.capacity} maxScore=${s.maxScore} avgScore=${s.avgScore} grade=${s.grade}`)}`
    );
    if (v) {
      for (const reason of v.reasons) {
        out.push(`         ${ansi.red('→')} ${reason}`);
      }
    }
  }

  out.push('');
  if (violations.length === 0) {
    out.push(ansi.green(ansi.bold(`✓ All ${results.length} file(s) passed cognitive load thresholds.`)));
  } else {
    out.push(
      ansi.red(
        ansi.bold(`✖ ${violations.length} of ${results.length} file(s) exceeded cognitive load thresholds.`)
      )
    );
  }
  return out.join('\n');
}

export function formatDiffReport(diff: DiffComparison, color = true): string {
  const ansi = new Ansi(color);
  const b = diff.before.summary;
  const a = diff.after.summary;

  const fmtDelta = (val: number, unit = '', lowerIsBetter = true): string => {
    if (val === 0) return ansi.dim(`0${unit}`);
    const sign = val > 0 ? '+' : '';
    const str = `${sign}${val}${unit}`;
    const good = lowerIsBetter ? val < 0 : val > 0;
    return good ? ansi.green(ansi.bold(str)) : ansi.red(ansi.bold(str));
  };

  const verdictBadge =
    diff.verdict === 'improved'
      ? ansi.bgGreen(` IMPROVED (${diff.improvementPct >= 0 ? '-' : '+'}${Math.abs(diff.improvementPct)}% load) `)
      : diff.verdict === 'regressed'
        ? ansi.bgRed(` REGRESSED (+${Math.abs(diff.improvementPct)}% load) `)
        : ansi.dim(' UNCHANGED ');

  const rows: Array<[string, string, string, string]> = [
    ['Grade', b.grade, a.grade, b.grade === a.grade ? ansi.dim('same') : `${b.grade} → ${a.grade}`],
    ['Peak WM Slots', `${b.peakSlots}/${diff.before.capacity}`, `${a.peakSlots}/${diff.after.capacity}`, fmtDelta(diff.peakSlotsDelta)],
    ['Avg Load Score', String(b.avgScore), String(a.avgScore), fmtDelta(diff.avgScoreDelta)],
    ['Max Line Score', String(b.maxScore), String(a.maxScore), fmtDelta(diff.maxScoreDelta)],
    ['Overload Lines', String(b.overloadLines), String(a.overloadLines), fmtDelta(diff.overloadLinesDelta)],
    ['Max Eye-Jump', `${b.maxJumpDistance}L`, `${a.maxJumpDistance}L`, fmtDelta(diff.maxJumpDelta, 'L')],
    ['Mutations', String(b.totalMutations), String(a.totalMutations), fmtDelta(diff.mutationsDelta)],
    ['Refactor Hints', String(diff.before.hints.length), String(diff.after.hints.length), fmtDelta(diff.hintsDelta)]
  ];

  const out: string[] = [];
  out.push(`${ansi.bold('CogTrace Refactor Cognitive Diff')}  ${verdictBadge}`);
  out.push(`  Before: ${ansi.dim(diff.before.fileName)}`);
  out.push(`  After:  ${ansi.dim(diff.after.fileName)}`);
  out.push('');
  out.push(
    `  ${'Metric'.padEnd(18)} ${'Before'.padStart(10)} ${'After'.padStart(10)}   Delta`
  );
  out.push(`  ${'─'.repeat(52)}`);
  for (const [label, bv, av, dv] of rows) {
    out.push(`  ${label.padEnd(18)} ${bv.padStart(10)} ${av.padStart(10)}   ${dv}`);
  }
  return out.join('\n');
}
