import { describe, expect, it } from 'vitest';
import { analyzeCode } from '../src/core/index.js';

describe('TypeScript / JavaScript AST Analyzer', () => {
  it('tracks variable lifetimes, destructuring, and default expressions accurately', () => {
    const code = `
export function summarize(order: { price: number; qty: number; tags: string[] }) {
  const fallback = 1;
  const { price, qty = fallback, tags: [firstTag] } = order;
  const total = price * qty;
  return \`\${firstTag}:\${total}\`;
}
`;
    const res = analyzeCode(code, { language: 'typescript', fileName: 'order.ts' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));

    expect(byName.has('order')).toBe(true);
    expect(byName.has('fallback')).toBe(true);
    expect(byName.has('price')).toBe(true);
    expect(byName.has('qty')).toBe(true);
    expect(byName.has('firstTag')).toBe(true);
    expect(byName.has('total')).toBe(true);

    // fallback is defined on line 3 and read in destructuring default on line 4
    expect(byName.get('fallback')!.defLine).toBe(3);
    expect(byName.get('fallback')!.lastUseLine).toBe(4);
    expect(byName.get('firstTag')!.lastUseLine).toBe(6);
    expect(byName.get('total')!.reads).toContain(6);
  });

  it('detects variable shadowing in nested blocks and inner functions', () => {
    const code = `
function compute(items: number[]) {
  const item = items[0];
  let total = item;
  if (items.length > 1) {
    const item = items[1] * 2;
    total += item;
  }
  return total + item;
}
`;
    const res = analyzeCode(code, { language: 'typescript' });
    const itemVars = res.variables.filter((v) => v.name === 'item');
    expect(itemVars).toHaveLength(2);
    expect(itemVars[0].isShadowed).toBe(false);
    expect(itemVars[1].isShadowed).toBe(true);
    expect(res.summary.shadowedCount).toBe(1);
    expect(res.hints.some((h) => h.category === 'shadowing' && h.variableName === 'item')).toBe(true);
  });

  it('detects closure captures across arrow & function boundaries without false positives on top-level helpers', () => {
    const code = `
function helper(n: number) {
  return n * 2;
}

export function buildCounter(seed: number) {
  let count = seed;
  const label = 'hits';
  const inc = (step: number) => {
    count += helper(step);
    return \`\${label}:\${count}\`;
  };
  return inc;
}
`;
    const res = analyzeCode(code, { language: 'typescript' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));

    // Top-level helper function is excluded from working-memory data bindings
    expect(byName.has('helper')).toBe(false);
    expect(byName.get('count')!.isCaptured).toBe(true);
    expect(byName.get('label')!.isCaptured).toBe(true);
    expect(byName.get('seed')!.isCaptured).toBe(false);
    expect(res.summary.capturedCount).toBe(2);
  });

  it('tracks direct reassignments, compound writes, ++/--, property writes, and mutating methods', () => {
    const code = `
function mutateAll(base) {
  let total = base;
  const list = [];
  const cache = new Map();
  total = total + 1;
  total += 5;
  total++;
  list.push(total);
  cache.set('k', total);
  cache.meta = true;
  return { total, list, cache };
}
`;
    const res = analyzeCode(code, { language: 'javascript', fileName: 'mutate.js' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));

    expect(byName.get('total')!.mutations).toEqual([6, 7, 8]);
    expect(byName.get('list')!.mutations).toEqual([9]);
    expect(byName.get('cache')!.mutations).toEqual([10, 11]);
    expect(res.summary.totalMutations).toBe(6);
  });

  it('detects non-linear control flow jumps (early return, break, continue, throw, catch) and ignores terminal return', () => {
    const code = `
function scan(values: number[]) {
  let acc = 0;
  if (values.length === 0) {
    return 0;
  }
  for (const v of values) {
    if (v < 0) continue;
    if (v > 999) break;
    try {
      if (v === 13) throw new Error('bad');
      acc += v;
    } catch (err) {
      acc -= 1;
    }
  }
  return acc;
}
`;
    const res = analyzeCode(code, { language: 'typescript' });
    const line5 = res.lines[4]; // early return 0
    const line8 = res.lines[7]; // continue
    const line9 = res.lines[8]; // break
    const line11 = res.lines[10]; // throw
    const line13 = res.lines[12]; // catch
    const line17 = res.lines[16]; // terminal return acc

    expect(line5.controlFlowKinds).toContain('early-return');
    expect(line8.controlFlowKinds).toContain('continue');
    expect(line9.controlFlowKinds).toContain('break');
    expect(line11.controlFlowKinds).toContain('throw');
    expect(line13.controlFlowKinds).toContain('catch');
    expect(line17.controlFlowJump).toBe(false);
    expect(res.summary.maxNestingDepth).toBeGreaterThanOrEqual(3);
  });

  it('parses TSX component files without confusing intrinsic HTML tags for variable reads', () => {
    const code = `
export function Badge({ label, count }: { label: string; count: number }) {
  const display = \`\${label} (\${count})\`;
  return <div className="badge"><span>{display}</span></div>;
}
`;
    const res = analyzeCode(code, { language: 'typescript', fileName: 'Badge.tsx' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));
    expect(byName.get('display')!.reads).toContain(4);
    expect(byName.get('label')!.reads).toContain(3);
    expect(byName.get('count')!.reads).toContain(3);
  });

  it('tracks destructuring assignment writes such as array swaps and object unpacking writes', () => {
    const code = `
function swapAndAssign(input: { x: number; y: number }) {
  let a = 1;
  let b = 2;
  [a, b] = [b, a];
  ({ x: a, y: b } = input);
  return a + b;
}
`;
    const res = analyzeCode(code, { language: 'typescript' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));
    expect(byName.get('a')!.mutations).toEqual([5, 6]);
    expect(byName.get('b')!.mutations).toEqual([5, 6]);
  });
});
