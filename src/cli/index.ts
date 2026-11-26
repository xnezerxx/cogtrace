#!/usr/bin/env node
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_WM_CAPACITY,
  analyzeCode,
  compareRefactor,
  detectLanguageFromFileName,
  generateHtmlReport,
  type AnalysisResult,
  type Language
} from '../core/index.js';
import {
  formatAnalysisReport,
  formatCheckReport,
  formatDiffReport,
  type CheckViolation
} from './format.js';

export const CLI_VERSION = '0.1.0';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.next',
  '.cache',
  '.turbo'
]);

const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py'
]);

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd?: string;
}

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`)
};

export function collectTargetFiles(targetPath: string): string[] {
  const abs = resolve(targetPath);
  const stat = statSync(abs);
  if (stat.isFile()) {
    return [abs];
  }
  const files: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          walk(resolve(dir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(resolve(dir, entry.name));
        }
      }
    }
  };
  walk(abs);
  return files;
}

function parseNumberFlag(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    throw new Error(`Missing numeric value for ${flagName}`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid numeric value "${value}" for ${flagName}`);
  }
  return num;
}

function parseLanguageFlag(value: string | undefined): Language {
  if (value === 'ts' || value === 'typescript') return 'typescript';
  if (value === 'js' || value === 'javascript') return 'javascript';
  if (value === 'py' || value === 'python') return 'python';
  throw new Error(`Unsupported language "${value}". Expected: typescript | javascript | python`);
}

function getHelpText(): string {
  return `CogTrace v${CLI_VERSION} — Working-Memory Cognitive Load Simulator & Eye-Jump Visualizer

Usage:
  cogtrace analyze <file-or-dir> [options]
  cogtrace check <file-or-dir> [--max-slots <N>] [--max-score <S>] [--max-avg-score <S>]
  cogtrace diff <beforeFile> <afterFile> [options]
  cogtrace report <file> [-o <output.html>] [options]

Commands:
  analyze   Analyze JS/TS/Python files and print cognitive load heatmap, hotspots & hints
  check     CI quality gate — exits with code 1 if any file exceeds thresholds
  diff      Compare two file versions and show exact working-memory & eye-jump deltas
  report    Generate a self-contained single-file interactive HTML X-Ray report

Options:
  --capacity <N>        Working-memory slot capacity (Miller's limit, default: 7)
  --max-slots <N>       Maximum allowed peak live slots (check command)
  --max-score <S>       Maximum allowed peak line cognitive score (check command)
  --max-avg-score <S>   Maximum allowed average cognitive score (check command)
  --top <N>             Number of hotspots/hints to display (default: 5)
  --lang <language>     Force language: typescript | javascript | python
  -o, --output <path>   Output HTML path for report command (default: cogtrace-report.html)
  --json                Output machine-readable JSON
  --no-color            Disable ANSI colors
  -h, --help            Show this help message
  -v, --version         Show version`;
}

function analyzeFile(
  filePath: string,
  cwd: string,
  capacity: number,
  forcedLanguage?: Language
): AnalysisResult {
  const source = readFileSync(filePath, 'utf8');
  const displayPath = relative(cwd, filePath) || filePath;
  const language = forcedLanguage ?? detectLanguageFromFileName(filePath) ?? 'typescript';
  return analyzeCode(source, {
    fileName: displayPath.replace(/\\/g, '/'),
    language,
    capacity
  });
}

export async function runCli(argv: string[], io: CliIO = DEFAULT_IO): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      flags.set('help', true);
    } else if (arg === '-v' || arg === '--version') {
      flags.set('version', true);
    } else if (arg === '--json') {
      flags.set('json', true);
    } else if (arg === '--no-color') {
      flags.set('no-color', true);
    } else if (
      arg === '--capacity' ||
      arg === '--max-slots' ||
      arg === '--max-score' ||
      arg === '--max-avg-score' ||
      arg === '--top' ||
      arg === '--lang' ||
      arg === '-o' ||
      arg === '--output'
    ) {
      const key = arg === '-o' ? 'output' : arg.replace(/^--/, '');
      const next = argv[++i];
      if (next === undefined) {
        io.stderr(`Error: missing value for ${arg}`);
        return 2;
      }
      flags.set(key, next);
    } else if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
    } else if (arg.startsWith('-')) {
      io.stderr(`Error: unknown option "${arg}"`);
      return 2;
    } else {
      positional.push(arg);
    }
  }

  if (flags.get('version')) {
    io.stdout(`cogtrace v${CLI_VERSION}`);
    return 0;
  }

  const command = positional[0];
  if (!command || flags.get('help')) {
    io.stdout(getHelpText());
    return 0;
  }

  const useColor = !flags.get('no-color') && !process.env.NO_COLOR;
  const asJson = Boolean(flags.get('json'));

  try {
    const capacity = flags.has('capacity')
      ? Math.max(1, Math.round(parseNumberFlag(String(flags.get('capacity')), '--capacity')))
      : DEFAULT_WM_CAPACITY;
    const forcedLang = flags.has('lang')
      ? parseLanguageFlag(String(flags.get('lang')))
      : undefined;

    if (command === 'analyze') {
      const target = positional[1];
      if (!target) {
        io.stderr('Error: `cogtrace analyze` requires a <file-or-dir> path.');
        return 2;
      }
      const files = collectTargetFiles(resolve(cwd, target));
      if (files.length === 0) {
        io.stderr(`No supported JS/TS/Python files found in "${target}".`);
        return 1;
      }
      const results = files.map((f) => analyzeFile(f, cwd, capacity, forcedLang));
      if (asJson) {
        io.stdout(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
        return 0;
      }
      const top = flags.has('top')
        ? Math.max(1, Math.round(parseNumberFlag(String(flags.get('top')), '--top')))
        : 5;
      const rendered = results
        .map((r) => formatAnalysisReport(r, { color: useColor, topHotspots: top, topHints: top }))
        .join('\n\n');
      io.stdout(rendered);
      return 0;
    }

    if (command === 'check') {
      const target = positional[1];
      if (!target) {
        io.stderr('Error: `cogtrace check` requires a <file-or-dir> path.');
        return 2;
      }
      const maxSlots = flags.has('max-slots')
        ? parseNumberFlag(String(flags.get('max-slots')), '--max-slots')
        : undefined;
      const maxScore = flags.has('max-score')
        ? parseNumberFlag(String(flags.get('max-score')), '--max-score')
        : undefined;
      const maxAvgScore = flags.has('max-avg-score')
        ? parseNumberFlag(String(flags.get('max-avg-score')), '--max-avg-score')
        : undefined;

      const effectiveMaxSlots =
        maxSlots === undefined && maxScore === undefined && maxAvgScore === undefined
          ? capacity
          : maxSlots;

      const files = collectTargetFiles(resolve(cwd, target));
      if (files.length === 0) {
        io.stderr(`No supported JS/TS/Python files found in "${target}".`);
        return 1;
      }
      const results = files.map((f) => analyzeFile(f, cwd, capacity, forcedLang));
      const violations: CheckViolation[] = [];

      for (const r of results) {
        const reasons: string[] = [];
        if (effectiveMaxSlots !== undefined && r.summary.peakSlots > effectiveMaxSlots) {
          reasons.push(
            `Peak working-memory slots ${r.summary.peakSlots} at L${r.summary.peakSlotsLine} exceeds --max-slots ${effectiveMaxSlots}`
          );
        }
        if (maxScore !== undefined && r.summary.maxScore > maxScore) {
          reasons.push(
            `Peak line cognitive score ${r.summary.maxScore} at L${r.summary.maxScoreLine} exceeds --max-score ${maxScore}`
          );
        }
        if (maxAvgScore !== undefined && r.summary.avgScore > maxAvgScore) {
          reasons.push(
            `Average cognitive score ${r.summary.avgScore} exceeds --max-avg-score ${maxAvgScore}`
          );
        }
        if (reasons.length > 0) {
          violations.push({ fileName: r.fileName, reasons, result: r });
        }
      }

      if (asJson) {
        io.stdout(
          JSON.stringify(
            {
              passed: violations.length === 0,
              thresholds: {
                maxSlots: effectiveMaxSlots,
                maxScore,
                maxAvgScore
              },
              filesChecked: results.length,
              violations: violations.map((v) => ({
                fileName: v.fileName,
                reasons: v.reasons,
                summary: v.result.summary
              }))
            },
            null,
            2
          )
        );
      } else {
        io.stdout(
          formatCheckReport(
            results,
            violations,
            { maxSlots: effectiveMaxSlots, maxScore, maxAvgScore },
            useColor
          )
        );
      }
      return violations.length === 0 ? 0 : 1;
    }

    if (command === 'diff') {
      const beforeArg = positional[1];
      const afterArg = positional[2];
      if (!beforeArg || !afterArg) {
        io.stderr('Error: `cogtrace diff` requires <beforeFile> <afterFile>.');
        return 2;
      }
      const beforeAbs = resolve(cwd, beforeArg);
      const afterAbs = resolve(cwd, afterArg);
      const beforeCode = readFileSync(beforeAbs, 'utf8');
      const afterCode = readFileSync(afterAbs, 'utf8');
      const lang =
        forcedLang ??
        detectLanguageFromFileName(afterAbs) ??
        detectLanguageFromFileName(beforeAbs) ??
        'typescript';

      const diff = compareRefactor(beforeCode, afterCode, lang, {
        capacity
      });
      diff.before.fileName = (relative(cwd, beforeAbs) || beforeArg).replace(/\\/g, '/');
      diff.after.fileName = (relative(cwd, afterAbs) || afterArg).replace(/\\/g, '/');

      if (asJson) {
        io.stdout(JSON.stringify(diff, null, 2));
      } else {
        io.stdout(formatDiffReport(diff, useColor));
      }
      return 0;
    }

    if (command === 'report') {
      const target = positional[1];
      if (!target) {
        io.stderr('Error: `cogtrace report` requires a <file> path.');
        return 2;
      }
      const absTarget = resolve(cwd, target);
      const result = analyzeFile(absTarget, cwd, capacity, forcedLang);
      const html = generateHtmlReport(result);
      const outArg = flags.has('output') ? String(flags.get('output')) : 'cogtrace-report.html';
      const outAbs = resolve(cwd, outArg);
      mkdirSync(dirname(outAbs), { recursive: true });
      writeFileSync(outAbs, html, 'utf8');
      io.stdout(
        `Generated interactive CogTrace X-Ray report: ${outArg} (Grade ${result.summary.grade}, peak ${result.summary.peakSlots}/${result.capacity} slots)`
      );
      return 0;
    }

    io.stderr(`Error: unknown command "${command}". Run \`cogtrace --help\` for usage.`);
    return 2;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr(`Error: ${message}`);
    return 1;
  }
}

function isExecutedDirectly(): boolean {
  if (!process.argv[1]) return false;
  try {
    const selfPath = fileURLToPath(import.meta.url);
    return resolve(process.argv[1]) === resolve(selfPath);
  } catch {
    return false;
  }
}

if (isExecutedDirectly()) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
