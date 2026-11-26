import type {
  AnalysisOptions,
  AnalysisResult,
  AnalysisSummary,
  CognitiveGrade,
  DiffComparison,
  EyeJumpArc,
  Language,
  LineMetrics,
  ParsedProgram,
  RefactoringHint,
  Severity,
  VarEvent,
  VariableLifecycle
} from './types.js';
import { parseTypeScriptOrJavaScript } from './parser-ts.js';
import { parsePython } from './parser-py.js';

export const DEFAULT_WM_CAPACITY = 7;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isTrackedWorkingMemoryBinding(
  kind: VariableLifecycle['kind'],
  scopeDepth: number
): boolean {
  if (kind === 'import') return false;
  if ((kind === 'function' || kind === 'class') && scopeDepth === 0) return false;
  return true;
}

function computeLineScore(params: {
  slotCount: number;
  capacity: number;
  jumpSum: number;
  maxJumpHere: number;
  mutationCount: number;
  nestingDepth: number;
  shadowingEvents: number;
  captureEvents: number;
  controlFlowCount: number;
}): number {
  const {
    slotCount,
    capacity,
    jumpSum,
    maxJumpHere,
    mutationCount,
    nestingDepth,
    shadowingEvents,
    captureEvents,
    controlFlowCount
  } = params;

  const baseSlots = Math.min(slotCount, capacity);
  const overflow = Math.max(0, slotCount - capacity);

  // Miller's 7±2 model: linear up to capacity, steep super-linear penalty past capacity
  const slotScore =
    baseSlots * 4.2 + (overflow > 0 ? overflow * 10.5 + Math.pow(overflow, 1.7) * 6.0 : 0);

  // Eye-jump saccade cost (vertical scan back to def or last mutation)
  const jumpScore =
    jumpSum > 0
      ? Math.min(26, Math.sqrt(jumpSum) * 2.1 + (maxJumpHere > 14 ? (maxJumpHere - 14) * 0.35 : 0))
      : 0;

  // State mutation invalidation cost
  const mutationScore = mutationCount * 6.5;

  // Nesting stack cost
  const nestingScore =
    nestingDepth <= 0
      ? 0
      : nestingDepth === 1
        ? 2.0
        : 2.0 + Math.pow(nestingDepth - 1, 1.45) * 4.5;

  // Shadowing & closure boundary cognitive overhead
  const shadowScore = shadowingEvents * 10.0;
  const captureScore = captureEvents * 7.0;

  // Non-linear control flow jump
  const controlFlowScore = controlFlowCount * 5.0;

  return round1(
    slotScore +
      jumpScore +
      mutationScore +
      nestingScore +
      shadowScore +
      captureScore +
      controlFlowScore
  );
}

function classifySeverity(slotCount: number, capacity: number, score: number): Severity {
  if (slotCount > capacity || score >= 65) return 'overload';
  if (score >= 42 || slotCount === capacity) return 'high';
  if (score >= 22 || slotCount >= Math.max(4, capacity - 2)) return 'moderate';
  return 'calm';
}

function computeGrade(
  avgScore: number,
  peakSlots: number,
  capacity: number,
  overloadLines: number
): CognitiveGrade {
  if (avgScore < 22 && peakSlots <= capacity && overloadLines === 0) return 'A';
  if (avgScore < 34 && peakSlots <= capacity + 1 && overloadLines <= 2) return 'B';
  if (avgScore < 48 && peakSlots <= capacity + 2) return 'C';
  if (avgScore < 68) return 'D';
  return 'F';
}

function mergeLineRanges(lines: number[], maxGap = 1): Array<{ start: number; end: number }> {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: Array<{ start: number; end: number }> = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= end + maxGap + 1) {
      end = sorted[i];
    } else {
      ranges.push({ start, end });
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push({ start, end });
  return ranges;
}

function generateHints(
  lines: LineMetrics[],
  variables: VariableLifecycle[],
  capacity: number
): RefactoringHint[] {
  const hints: RefactoringHint[] = [];
  let hintSeq = 0;

  // 1. Working-Memory Overflow Spans
  const overflowLineNums = lines.filter((l) => l.overflow > 0).map((l) => l.line);
  for (const span of mergeLineRanges(overflowLineNums, 1)) {
    let peak = 0;
    let peakLine = span.start;
    let peakNames: string[] = [];
    for (let l = span.start; l <= span.end; l++) {
      const lm = lines[l - 1];
      if (lm && lm.slotCount > peak) {
        peak = lm.slotCount;
        peakLine = lm.line;
        peakNames = lm.liveVarNames;
      }
    }
    const overBy = peak - capacity;
    const rangeLabel =
      span.start === span.end ? `line ${span.start}` : `lines ${span.start}–${span.end}`;
    const previewVars = peakNames.slice(0, 6).join(', ') + (peakNames.length > 6 ? ', …' : '');
    hints.push({
      id: `hint_${hintSeq++}`,
      category: 'memory-overflow',
      severity: 'critical',
      title: `Peak working-memory overflow (${peak}/${capacity} slots) at ${rangeLabel}`,
      detail: `At line ${peakLine}, a reader must juggle ${peak} simultaneous live bindings (${previewVars}), exceeding Miller's ${capacity}-slot limit by +${overBy}.`,
      suggestion:
        'Extract a cohesive pure helper function for this span so intermediate variables leave working memory immediately.',
      startLine: span.start,
      endLine: span.end,
      impactScore: 100 + overBy * 18 + (span.end - span.start + 1) * 1.5
    });
  }

  // 2. Long-Range Variable Lifetimes & Eye-Jumps
  for (const v of variables) {
    const lifetime = v.lastUseLine - v.defLine;
    if (lifetime >= 20 || v.maxJumpDistance >= 18) {
      const spanDist = Math.max(lifetime, v.maxJumpDistance);
      hints.push({
        id: `hint_${hintSeq++}`,
        category: 'long-lifetime',
        severity: spanDist >= 35 ? 'critical' : 'warning',
        title: `Long-range variable lifetime: \`${v.name}\` spans ${lifetime} lines (L${v.defLine}→L${v.lastUseLine})`,
        detail: `\`${v.name}\` is declared at line ${v.defLine} and stays live through line ${v.lastUseLine} with a max vertical eye-jump of ${v.maxJumpDistance} lines.`,
        suggestion:
          'Declare variables as close as possible to first use, or split the routine into smaller stage functions passing only required inputs.',
        startLine: v.defLine,
        endLine: v.lastUseLine,
        variableName: v.name,
        impactScore: 55 + spanDist * 1.2
      });
    }
  }

  // 3. Variable Shadowing
  for (const v of variables) {
    if (v.isShadowed) {
      hints.push({
        id: `hint_${hintSeq++}`,
        category: 'shadowing',
        severity: 'warning',
        title: `Shadowed identifier \`${v.name}\` at line ${v.defLine} increases mental swap cost`,
        detail: `Inner binding \`${v.name}\` reuses a name already active in an enclosing scope, forcing readers to disambiguate which binding is in play.`,
        suggestion: `Rename inner \`${v.name}\` to a more specific domain identifier (e.g. \`current_${v.name}\` or \`scoped${v.name[0].toUpperCase()}${v.name.slice(1)}\`).`,
        startLine: v.defLine,
        endLine: v.lastUseLine,
        variableName: v.name,
        impactScore: 68
      });
    }
  }

  // 4. High Mutation Density
  for (const v of variables) {
    if (v.mutations.length >= 3) {
      const uniqueLines = Array.from(new Set(v.mutations)).sort((a, b) => a - b);
      hints.push({
        id: `hint_${hintSeq++}`,
        category: 'high-mutation',
        severity: v.mutations.length >= 5 ? 'critical' : 'warning',
        title: `High mutation density on \`${v.name}\` (${v.mutations.length} writes)`,
        detail: `\`${v.name}\` is mutated at lines ${uniqueLines.join(', ')}. Every write forces readers to mentally invalidate and recalculate its prior value.`,
        suggestion:
          'Replace step-by-step mutations with immutable derived constants or a pure reducer/transform helper.',
        startLine: v.defLine,
        endLine: v.lastUseLine,
        variableName: v.name,
        impactScore: 60 + v.mutations.length * 7
      });
    }
  }

  // 5. Closure Captures
  for (const v of variables) {
    if (v.isCaptured) {
      const isMutableCapture = v.mutations.length > 0;
      hints.push({
        id: `hint_${hintSeq++}`,
        category: 'closure-capture',
        severity: isMutableCapture ? 'warning' : 'info',
        title: isMutableCapture
          ? `Mutable closure capture on \`${v.name}\` (defined at line ${v.defLine})`
          : `Closure capture of \`${v.name}\` across nested function boundary`,
        detail: isMutableCapture
          ? `\`${v.name}\` is both mutated (${v.mutations.length}×) and captured across an inner function boundary, creating hidden temporal coupling.`
          : `\`${v.name}\` is captured from an outer scope into an inner function, adding cross-frame lookup overhead.`,
        suggestion: isMutableCapture
          ? 'Return values from the inner function instead of mutating captured outer state, or pass explicit parameters.'
          : 'Consider passing values explicitly to named helper functions when closures span many lines.',
        startLine: v.defLine,
        endLine: v.lastUseLine,
        variableName: v.name,
        impactScore: isMutableCapture ? 74 + v.mutations.length * 4 : 38
      });
    }
  }

  // 6. Deep Nesting Hotspots
  const deepLines = lines.filter((l) => l.nestingDepth >= 4).map((l) => l.line);
  for (const span of mergeLineRanges(deepLines, 1)) {
    let maxDepth = 0;
    for (let l = span.start; l <= span.end; l++) {
      if (lines[l - 1] && lines[l - 1].nestingDepth > maxDepth) {
        maxDepth = lines[l - 1].nestingDepth;
      }
    }
    const rangeLabel =
      span.start === span.end ? `line ${span.start}` : `lines ${span.start}–${span.end}`;
    hints.push({
      id: `hint_${hintSeq++}`,
      category: 'deep-nesting',
      severity: maxDepth >= 5 ? 'critical' : 'warning',
      title: `Deep nesting (depth ${maxDepth}) at ${rangeLabel}`,
      detail: `Readers must hold ${maxDepth} active branch/loop conditions simultaneously alongside live variables.`,
      suggestion:
        'Invert conditions into early-return guard clauses or extract the inner loop body into a named helper.',
      startLine: span.start,
      endLine: span.end,
      impactScore: 52 + (maxDepth - 3) * 12
    });
  }

  hints.sort((a, b) => b.impactScore - a.impactScore || a.startLine - b.startLine);
  return hints;
}

export function simulateCognitiveLoad(
  parsed: ParsedProgram,
  options: AnalysisOptions = {}
): AnalysisResult {
  const capacity = Math.max(1, Math.round(options.capacity ?? DEFAULT_WM_CAPACITY));
  const fileName =
    options.fileName ??
    (parsed.language === 'python'
      ? 'input.py'
      : parsed.language === 'javascript'
        ? 'input.js'
        : 'input.ts');
  const totalLines = parsed.sourceLines.length;

  // Group events by binding id
  const eventsByVar = new Map<string, VarEvent[]>();
  for (const ev of parsed.events) {
    let list = eventsByVar.get(ev.varId);
    if (!list) {
      list = [];
      eventsByVar.set(ev.varId, list);
    }
    list.push(ev);
  }

  const variables: VariableLifecycle[] = [];
  const arcs: EyeJumpArc[] = [];
  const arcKeySet = new Set<string>();

  const lineMutationCounts = new Array<number>(totalLines).fill(0);
  const lineShadowEvents = new Array<number>(totalLines).fill(0);
  const lineCaptureEvents = new Array<number>(totalLines).fill(0);
  const trackedEvents: VarEvent[] = [];

  for (const binding of parsed.bindings.values()) {
    if (!isTrackedWorkingMemoryBinding(binding.kind, binding.scopeDepth)) {
      continue;
    }

    const varEvents = [...(eventsByVar.get(binding.id) ?? [])].sort(
      (a, b) => a.line - b.line || a.column - b.column
    );
    trackedEvents.push(...varEvents);

    const reads: number[] = [];
    const mutations: number[] = [];
    let isCaptured = false;
    let lastUseLine = binding.defLine;
    let lastWriteLine: number | null = null;
    let maxJumpDistance = 0;

    if (binding.isShadowed && binding.defLine >= 1 && binding.defLine <= totalLines) {
      lineShadowEvents[binding.defLine - 1]++;
    }

    for (const ev of varEvents) {
      if (ev.kind === 'def') continue;

      if (ev.line > lastUseLine) lastUseLine = ev.line;

      // Detect closure capture across function boundaries
      const evScope = parsed.scopes.get(ev.scopeId);
      if (evScope && evScope.functionBoundaryId !== binding.functionBoundaryId) {
        isCaptured = true;
        if (ev.line >= 1 && ev.line <= totalLines) {
          lineCaptureEvents[ev.line - 1]++;
        }
      }

      if (ev.kind === 'write') {
        mutations.push(ev.line);
        if (ev.line >= 1 && ev.line <= totalLines) {
          lineMutationCounts[ev.line - 1]++;
        }
        if (ev.line !== binding.defLine) {
          const dist = Math.abs(ev.line - binding.defLine);
          const key = `${binding.id}|${binding.defLine}|${ev.line}|def-to-write`;
          if (!arcKeySet.has(key)) {
            arcKeySet.add(key);
            arcs.push({
              varId: binding.id,
              varName: binding.name,
              fromLine: binding.defLine,
              toLine: ev.line,
              kind: 'def-to-write',
              distance: dist
            });
          }
          if (dist > maxJumpDistance) maxJumpDistance = dist;
        }
        lastWriteLine = ev.line;
      } else if (ev.kind === 'read') {
        reads.push(ev.line);
        if (lastWriteLine !== null && lastWriteLine !== ev.line) {
          const dist = Math.abs(ev.line - lastWriteLine);
          const key = `${binding.id}|${lastWriteLine}|${ev.line}|write-to-read`;
          if (!arcKeySet.has(key)) {
            arcKeySet.add(key);
            arcs.push({
              varId: binding.id,
              varName: binding.name,
              fromLine: lastWriteLine,
              toLine: ev.line,
              kind: 'write-to-read',
              distance: dist
            });
          }
          if (dist > maxJumpDistance) maxJumpDistance = dist;
        } else if (ev.line !== binding.defLine) {
          const dist = Math.abs(ev.line - binding.defLine);
          const key = `${binding.id}|${binding.defLine}|${ev.line}|def-to-read`;
          if (!arcKeySet.has(key)) {
            arcKeySet.add(key);
            arcs.push({
              varId: binding.id,
              varName: binding.name,
              fromLine: binding.defLine,
              toLine: ev.line,
              kind: 'def-to-read',
              distance: dist
            });
          }
          if (dist > maxJumpDistance) maxJumpDistance = dist;
        }
      }
    }

    variables.push({
      id: binding.id,
      name: binding.name,
      scopeId: binding.scopeId,
      scopeDepth: binding.scopeDepth,
      defLine: binding.defLine,
      lastUseLine,
      mutations,
      reads,
      isShadowed: binding.isShadowed,
      isCaptured,
      maxJumpDistance,
      kind: binding.kind
    });
  }

  variables.sort((a, b) => a.defLine - b.defLine || a.id.localeCompare(b.id));
  trackedEvents.sort((a, b) => a.line - b.line || a.column - b.column);
  arcs.sort((a, b) => a.toLine - b.toLine || b.distance - a.distance);

  // Index arcs landing on each line
  const arcsByTargetLine = new Map<number, EyeJumpArc[]>();
  for (const arc of arcs) {
    let arr = arcsByTargetLine.get(arc.toLine);
    if (!arr) {
      arr = [];
      arcsByTargetLine.set(arc.toLine, arr);
    }
    arr.push(arc);
  }

  // Compute per-line metrics
  const lines: LineMetrics[] = [];
  let peakSlots = 0;
  let peakSlotsLine = 1;
  let maxScore = 0;
  let maxScoreLine = 1;
  let overloadLines = 0;
  let highLines = 0;
  let codeLines = 0;
  let sumScore = 0;
  let sumSlots = 0;
  let maxNestingDepth = 0;
  let controlFlowJumps = 0;

  for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
    const idx = lineNum - 1;
    const text = parsed.sourceLines[idx] ?? '';
    const isCodeLine = text.trim().length > 0;

    const live: VariableLifecycle[] = [];
    for (const v of variables) {
      if (v.defLine <= lineNum && lineNum <= v.lastUseLine) {
        live.push(v);
      }
    }

    const slotCount = live.length;
    const overflow = Math.max(0, slotCount - capacity);
    const nestingDepth = parsed.lineNesting[idx] ?? 0;
    const cfKinds = parsed.lineControlFlow[idx] ?? [];
    const controlFlowJump = cfKinds.length > 0;
    const mutationCount = lineMutationCounts[idx] ?? 0;
    const shadowingEvents = lineShadowEvents[idx] ?? 0;
    const captureEvents = lineCaptureEvents[idx] ?? 0;

    const incomingArcs = arcsByTargetLine.get(lineNum) ?? [];
    let jumpSum = 0;
    let maxJumpHere = 0;
    for (const a of incomingArcs) {
      jumpSum += a.distance;
      if (a.distance > maxJumpHere) maxJumpHere = a.distance;
    }

    const score = computeLineScore({
      slotCount,
      capacity,
      jumpSum,
      maxJumpHere,
      mutationCount,
      nestingDepth,
      shadowingEvents,
      captureEvents,
      controlFlowCount: cfKinds.length
    });
    const severity = classifySeverity(slotCount, capacity, score);

    lines.push({
      line: lineNum,
      text,
      liveVars: live.map((v) => v.id),
      liveVarNames: live.map((v) => v.name),
      slotCount,
      overflow,
      nestingDepth,
      jumpSum,
      maxJumpHere,
      mutationCount,
      controlFlowJump,
      controlFlowKinds: cfKinds,
      shadowingEvents,
      captureEvents,
      score,
      severity
    });

    if (isCodeLine) {
      codeLines++;
      sumScore += score;
      sumSlots += slotCount;
      if (severity === 'overload') overloadLines++;
      if (severity === 'high') highLines++;
      if (slotCount > peakSlots) {
        peakSlots = slotCount;
        peakSlotsLine = lineNum;
      }
      if (score > maxScore) {
        maxScore = score;
        maxScoreLine = lineNum;
      }
    }

    if (nestingDepth > maxNestingDepth) maxNestingDepth = nestingDepth;
    if (controlFlowJump) controlFlowJumps += cfKinds.length;
  }

  const avgScore = codeLines > 0 ? round1(sumScore / codeLines) : 0;
  const avgSlots = codeLines > 0 ? round1(sumSlots / codeLines) : 0;
  const maxJumpDistance = arcs.reduce((acc, a) => Math.max(acc, a.distance), 0);
  const totalMutations = variables.reduce((acc, v) => acc + v.mutations.length, 0);
  const shadowedCount = variables.filter((v) => v.isShadowed).length;
  const capturedCount = variables.filter((v) => v.isCaptured).length;
  const grade = computeGrade(avgScore, peakSlots, capacity, overloadLines);

  const summary: AnalysisSummary = {
    totalLines,
    codeLines,
    totalVariables: variables.length,
    peakSlots,
    peakSlotsLine,
    avgSlots,
    avgScore,
    maxScore,
    maxScoreLine,
    overloadLines,
    highLines,
    maxJumpDistance,
    totalMutations,
    shadowedCount,
    capturedCount,
    maxNestingDepth,
    controlFlowJumps,
    grade
  };

  const hints = generateHints(lines, variables, capacity);

  return {
    fileName,
    language: parsed.language,
    capacity,
    source: parsed.sourceLines.join('\n'),
    lines,
    variables,
    events: trackedEvents,
    arcs,
    hints,
    summary
  };
}

export function detectLanguageFromFileName(fileName: string): Language | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.py') || lower.endsWith('.pyw')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return 'typescript';
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript';
  }
  return null;
}

export function analyzeCode(code: string, options: AnalysisOptions = {}): AnalysisResult {
  const detected = options.fileName ? detectLanguageFromFileName(options.fileName) : null;
  const language: Language = options.language ?? detected ?? 'typescript';

  const parsed =
    language === 'python'
      ? parsePython(code)
      : parseTypeScriptOrJavaScript(code, language, options.fileName);

  return simulateCognitiveLoad(parsed, { ...options, language });
}

export function compareRefactor(
  beforeCode: string,
  afterCode: string,
  language: Language = 'typescript',
  options: Omit<AnalysisOptions, 'language'> = {}
): DiffComparison {
  const before = analyzeCode(beforeCode, {
    ...options,
    language,
    fileName: options.fileName ? `before:${options.fileName}` : `before.${language === 'python' ? 'py' : language === 'javascript' ? 'js' : 'ts'}`
  });
  const after = analyzeCode(afterCode, {
    ...options,
    language,
    fileName: options.fileName ? `after:${options.fileName}` : `after.${language === 'python' ? 'py' : language === 'javascript' ? 'js' : 'ts'}`
  });

  const peakSlotsDelta = after.summary.peakSlots - before.summary.peakSlots;
  const avgScoreDelta = round1(after.summary.avgScore - before.summary.avgScore);
  const maxScoreDelta = round1(after.summary.maxScore - before.summary.maxScore);
  const overloadLinesDelta = after.summary.overloadLines - before.summary.overloadLines;
  const maxJumpDelta = after.summary.maxJumpDistance - before.summary.maxJumpDistance;
  const mutationsDelta = after.summary.totalMutations - before.summary.totalMutations;
  const hintsDelta = after.hints.length - before.hints.length;

  const improvementPct =
    before.summary.avgScore > 0
      ? round1(((before.summary.avgScore - after.summary.avgScore) / before.summary.avgScore) * 100)
      : 0;

  let verdict: DiffComparison['verdict'] = 'unchanged';
  if (avgScoreDelta < -1 || (Math.abs(avgScoreDelta) <= 1 && peakSlotsDelta < 0)) {
    verdict = 'improved';
  } else if (avgScoreDelta > 1 || (Math.abs(avgScoreDelta) <= 1 && peakSlotsDelta > 0)) {
    verdict = 'regressed';
  }

  return {
    before,
    after,
    peakSlotsDelta,
    avgScoreDelta,
    maxScoreDelta,
    overloadLinesDelta,
    maxJumpDelta,
    mutationsDelta,
    hintsDelta,
    improvementPct,
    verdict
  };
}
