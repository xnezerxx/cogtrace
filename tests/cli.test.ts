import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/index.js';
import { EXAMPLES } from '../src/web/examples.js';

describe('CogTrace CLI (analyze, check, diff, report)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cogtrace-cli-test-'));
    writeFileSync(join(tempDir, 'spaghetti.ts'), EXAMPLES[0].code, 'utf8');
    writeFileSync(join(tempDir, 'clean.ts'), EXAMPLES[0].refactoredCode!, 'utf8');
    writeFileSync(join(tempDir, 'parser.py'), EXAMPLES[1].code, 'utf8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function captureCli(args: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return runCli(args, {
      cwd: tempDir,
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s)
    }).then((code) => ({
      code,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n')
    }));
  }

  it('analyzes a single file and directory with sparkline, hotspots, and JSON output', async () => {
    const single = await captureCli(['analyze', 'spaghetti.ts', '--no-color']);
    expect(single.code).toBe(0);
    expect(single.stdout).toContain('spaghetti.ts');
    expect(single.stdout).toContain('WM Peak:');
    expect(single.stdout).toContain('Top Hotspots:');
    expect(single.stdout).toContain('Top Refactoring Hints');

    const dirJson = await captureCli(['analyze', '.', '--json']);
    expect(dirJson.code).toBe(0);
    const parsed = JSON.parse(dirJson.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
  });

  it('enforces CI quality gates via `check` and exits 1 when limits are exceeded', async () => {
    const failSlots = await captureCli([
      'check',
      'spaghetti.ts',
      '--max-slots',
      '7',
      '--max-score',
      '60',
      '--no-color'
    ]);
    expect(failSlots.code).toBe(1);
    expect(failSlots.stdout).toContain('FAIL');
    expect(failSlots.stdout).toContain('exceeded cognitive load thresholds');

    const passClean = await captureCli([
      'check',
      'clean.ts',
      '--max-slots',
      '7',
      '--max-score',
      '80',
      '--no-color'
    ]);
    expect(passClean.code).toBe(0);
    expect(passClean.stdout).toContain('PASS');
    expect(passClean.stdout).toContain('passed cognitive load thresholds');

    const failJson = await captureCli([
      'check',
      'spaghetti.ts',
      '--max-avg-score',
      '20',
      '--json'
    ]);
    expect(failJson.code).toBe(1);
    const parsedFail = JSON.parse(failJson.stdout);
    expect(parsedFail.passed).toBe(false);
    expect(parsedFail.violations).toHaveLength(1);
  });

  it('computes side-by-side cognitive refactor delta via `diff`', async () => {
    const res = await captureCli(['diff', 'spaghetti.ts', 'clean.ts', '--no-color']);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('CogTrace Refactor Cognitive Diff');
    expect(res.stdout).toContain('IMPROVED');
    expect(res.stdout).toContain('Peak WM Slots');

    const jsonRes = await captureCli(['diff', 'spaghetti.ts', 'clean.ts', '--json']);
    expect(jsonRes.code).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.verdict).toBe('improved');
    expect(parsed.peakSlotsDelta).toBeLessThan(0);
    expect(parsed.improvementPct).toBeGreaterThan(25);
  });

  it('writes a standalone interactive HTML report via `report -o`', async () => {
    const outPath = join(tempDir, 'out', 'xray.html');
    const res = await captureCli(['report', 'parser.py', '-o', outPath]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Generated interactive CogTrace X-Ray report');

    const html = readFileSync(outPath, 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('parser.py');
    expect(html).toContain('const DATA = ');
  });

  it('handles --help, --version, and invalid commands cleanly', async () => {
    const help = await captureCli(['--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage:');

    const ver = await captureCli(['--version']);
    expect(ver.code).toBe(0);
    expect(ver.stdout).toContain('cogtrace v');

    const bad = await captureCli(['unknown-cmd']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain('unknown command');
  });
});
