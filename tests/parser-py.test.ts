import { describe, expect, it } from 'vitest';
import { analyzeCode } from '../src/core/index.js';

describe('Python Indentation & Lexical Scope Analyzer', () => {
  it('analyzes indentation blocks, unpacking, f-strings, augmented assignments, and mutating methods', () => {
    const code = `
def summarize_sales(rows, tax_rate=0.1):
    subtotal = 0.0
    notes = []
    for sku, price in rows:
        subtotal += price
        notes.append(f"{sku}:{price}")
    tax = subtotal * tax_rate
    return subtotal + tax, notes
`;
    const res = analyzeCode(code, { language: 'python', fileName: 'sales.py' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));

    expect(byName.get('subtotal')!.mutations).toEqual([6]);
    expect(byName.get('subtotal')!.reads).toContain(6);
    expect(byName.get('subtotal')!.reads).toContain(8);
    expect(byName.get('subtotal')!.reads).toContain(9);
    expect(byName.get('notes')!.mutations).toEqual([7]);
    expect(byName.get('notes')!.reads).toContain(9);
    expect(byName.get('sku')!.reads).toContain(7);
    expect(byName.get('price')!.reads).toContain(6);
    expect(byName.get('price')!.reads).toContain(7);
  });

  it('tracks Python closures with nonlocal mutations and read-only free variable captures', () => {
    const code = `
def make_tracker(prefix):
    count = 0
    events = []

    def record(msg):
        nonlocal count
        count += 1
        events.append(f"{prefix}:{count}:{msg}")
        return count

    return record
`;
    const res = analyzeCode(code, { language: 'python' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));

    expect(byName.get('count')!.isCaptured).toBe(true);
    expect(byName.get('count')!.mutations).toContain(8);
    expect(byName.get('prefix')!.isCaptured).toBe(true);
    expect(byName.get('events')!.isCaptured).toBe(true);
    expect(byName.get('events')!.mutations).toContain(9);
  });

  it('detects shadowing in comprehensions and nested functions', () => {
    const code = `
def process(records):
    item = records[0]
    cleaned = [item.strip() for item in records if item]

    def inner(item):
        return item.upper()

    return inner(item), cleaned
`;
    const res = analyzeCode(code, { language: 'python' });
    const itemVars = res.variables.filter((v) => v.name === 'item');
    expect(itemVars).toHaveLength(3);
    expect(itemVars[0].isShadowed).toBe(false);
    expect(itemVars[1].isShadowed).toBe(true); // comprehension
    expect(itemVars[2].isShadowed).toBe(true); // nested def param
    expect(res.summary.shadowedCount).toBe(2);
  });

  it('tracks with, try/except, raise, break, continue, early return, and ignores keyword arg labels', () => {
    const code = `
def load_records(paths, limit):
    total = 0
    if not paths:
        return []
    out = []
    for path in paths:
        with open(path) as handle:
            try:
                raw = handle.read()
                if not raw:
                    continue
                if len(out) >= limit:
                    break
                out.append(dict(total=raw))
            except OSError as err:
                raise RuntimeError(str(err))
    return out
`;
    const res = analyzeCode(code, { language: 'python', fileName: 'loader.py' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));

    // `dict(total=raw)` must NOT count as a read of local `total`
    expect(byName.get('total')!.reads).toEqual([]);
    expect(byName.get('handle')!.reads).toContain(10);
    expect(byName.get('err')!.reads).toContain(17);

    expect(res.lines[4].controlFlowKinds).toContain('early-return');
    expect(res.lines[11].controlFlowKinds).toContain('continue');
    expect(res.lines[13].controlFlowKinds).toContain('break');
    expect(res.lines[15].controlFlowKinds).toContain('catch');
    expect(res.lines[16].controlFlowKinds).toContain('throw');
    expect(res.lines[17].controlFlowJump).toBe(false); // terminal return
    expect(res.summary.maxNestingDepth).toBeGreaterThanOrEqual(4);
  });

  it('tracks lambda closure captures and walrus operator bindings', () => {
    const code = `
def build_scaler(multiplier, items):
    if (count := len(items)) == 0:
        return None
    fn = lambda value: value * multiplier + count
    return fn
`;
    const res = analyzeCode(code, { language: 'python' });
    const byName = new Map(res.variables.map((v) => [v.name, v]));
    expect(byName.has('count')).toBe(true);
    expect(byName.get('count')!.isCaptured).toBe(true);
    expect(byName.get('multiplier')!.isCaptured).toBe(true);
  });
});
