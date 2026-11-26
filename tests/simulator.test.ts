import { describe, expect, it } from 'vitest';
import { analyzeCode, compareRefactor } from '../src/core/index.js';
import { EXAMPLES } from '../src/web/examples.js';

describe('Working-Memory Simulator & Eye-Jump Engine', () => {
  it('detects Miller 7±2 working-memory overflow and generates overflow hints', () => {
    const code = `
function overloaded(a: number, b: number, c: number) {
  const d = a + 1;
  const e = b + 2;
  const f = c + 3;
  const g = d + e;
  const h = f + g;
  const i = h * 2;
  const j = i - 1;
  return a + b + c + d + e + f + g + h + i + j;
}
`;
    const res = analyzeCode(code, { language: 'typescript', capacity: 7 });
    expect(res.summary.peakSlots).toBe(10);
    expect(res.summary.overloadLines).toBeGreaterThan(0);

    const returnLine = res.lines[9]; // line 10
    expect(returnLine.slotCount).toBe(10);
    expect(returnLine.overflow).toBe(3);
    expect(returnLine.severity).toBe('overload');

    const overflowHint = res.hints.find((h) => h.category === 'memory-overflow');
    expect(overflowHint).toBeDefined();
    expect(overflowHint!.severity).toBe('critical');
    expect(overflowHint!.title).toContain('10/7');
  });

  it('produces accurate def-to-read, def-to-write, and write-to-read eye-jump arcs and distances', () => {
    const code = `function traceJumps(seed: number) {
  let acc = seed;
  const factor = 3;
  const padding = 10;
  acc = acc + padding;
  const doubled = acc * factor;
  return doubled;
}`;
    const res = analyzeCode(code, { language: 'typescript' });

    const defToWriteAcc = res.arcs.find(
      (a) => a.varName === 'acc' && a.kind === 'def-to-write' && a.fromLine === 2 && a.toLine === 5
    );
    const writeToReadAcc = res.arcs.find(
      (a) => a.varName === 'acc' && a.kind === 'write-to-read' && a.fromLine === 5 && a.toLine === 6
    );
    const defToReadFactor = res.arcs.find(
      (a) => a.varName === 'factor' && a.kind === 'def-to-read' && a.fromLine === 3 && a.toLine === 6
    );

    expect(defToWriteAcc).toBeDefined();
    expect(defToWriteAcc!.distance).toBe(3);
    expect(writeToReadAcc).toBeDefined();
    expect(writeToReadAcc!.distance).toBe(1);
    expect(defToReadFactor).toBeDefined();
    expect(defToReadFactor!.distance).toBe(3);
  });

  it('proves clean refactored code scores dramatically lower than spaghetti code across all built-in pairs', () => {
    const pairs = EXAMPLES.filter((ex) => Boolean(ex.refactoredCode));
    expect(pairs.length).toBeGreaterThanOrEqual(3);

    for (const pair of pairs) {
      const diff = compareRefactor(pair.code, pair.refactoredCode!, pair.language);
      expect(diff.verdict, `${pair.id} should improve`).toBe('improved');
      expect(diff.improvementPct, `${pair.id} improvement %`).toBeGreaterThan(25);
      expect(diff.peakSlotsDelta, `${pair.id} peak slots should drop`).toBeLessThan(0);
      expect(diff.avgScoreDelta, `${pair.id} avg score should drop`).toBeLessThan(0);
      expect(diff.overloadLinesDelta, `${pair.id} overload lines should drop`).toBeLessThanOrEqual(0);
      expect(diff.after.summary.avgScore).toBeLessThan(diff.before.summary.avgScore);
    }
  });

  it('handles empty, comment-only, and trivial files gracefully', () => {
    const emptyRes = analyzeCode('', { language: 'typescript' });
    expect(emptyRes.summary.peakSlots).toBe(0);
    expect(emptyRes.summary.avgScore).toBe(0);
    expect(emptyRes.summary.grade).toBe('A');
    expect(emptyRes.hints).toEqual([]);

    const pyCommentRes = analyzeCode('# just a comment\n\n# another\n', { language: 'python' });
    expect(pyCommentRes.summary.totalVariables).toBe(0);
    expect(pyCommentRes.summary.grade).toBe('A');
  });

  it('respects custom Miller capacity thresholds', () => {
    const code = `
function sixVars(a: number, b: number) {
  const c = a + b;
  const d = c * 2;
  const e = d - 1;
  const f = e + 4;
  return a + b + c + d + e + f;
}
`;
    const strict = analyzeCode(code, { language: 'typescript', capacity: 5 });
    const standard = analyzeCode(code, { language: 'typescript', capacity: 7 });

    expect(strict.summary.overloadLines).toBeGreaterThan(0);
    expect(standard.summary.overloadLines).toBe(0);
    expect(strict.summary.maxScore).toBeGreaterThan(standard.summary.maxScore);
  });
});
