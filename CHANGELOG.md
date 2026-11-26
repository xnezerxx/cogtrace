# Changelog

All notable changes to **CogTrace** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-26

### Added
- **Multi-Language Isomorphic Scope & Liveness Engine (`src/core/`)**:
  - Real TypeScript/JavaScript/JSX/TSX AST parser built on `typescript.createSourceFile()` tracking lexical scopes, object/array destructuring, mutations (`=`, `+=`, `++`, property writes, mutating array/map/set methods), shadowing, closure captures, nesting depth, and non-linear control flow (`break`, `continue`, `throw`, `catch`, early `return`).
  - Pure-TypeScript Python indentation and LEGB scope analyzer handling `def`, `class`, `for`, `with`, `try`/`except`, `nonlocal`/`global` closures, comprehensions, lambdas, f-string interpolations, augmented assignments, walrus operator, and control-flow jumps.
- **Human Working-Memory Simulator (`Miller's 7±2`)**:
  - Per-line liveness slot counter with super-linear overflow penalty above capacity (default 7 slots).
  - Curved `EyeJumpArc` extraction (`def-to-read`, `def-to-write`, `write-to-read`) with vertical line distance metrics.
  - Prioritized actionable `RefactoringHint` generation for memory overflows, long lifetimes, shadowing, mutation hotspots, mutable closure captures, and deep nesting.
  - `compareRefactor(before, after, lang)` quantifying exact cognitive load deltas and percentage improvement.
- **Self-Contained Interactive HTML Report (`generateHtmlReport`)**:
  - Generates zero-dependency offline `.html` X-Ray reports with embedded SVG eye-jump arcs, clickable sparkline, and live Working-Memory Brain HUD.
- **CLI (`cogtrace`)**:
  - `cogtrace analyze <file-or-dir>` with ANSI thermal sparkline, slot register gauge, hotspots, refactoring hints, and `--json`.
  - `cogtrace check <file-or-dir> --max-slots <N> --max-score <S>` CI quality gate exiting code `1` on violations.
  - `cogtrace diff <beforeFile> <afterFile>` side-by-side cognitive load delta table.
  - `cogtrace report <file> -o report.html` standalone HTML X-Ray visualizer generator.
- **Interactive Web X-Ray Studio (`src/web/`)**:
  - Dark telemetry UI with **Single File X-Ray** and **Before / After Refactor Arena** tabs.
  - 4 built-in realistic examples across TypeScript, JavaScript, and Python.
  - Live code editing, glowing SVG eye-jump arcs, interactive 7-slot Working-Memory Brain HUD, variable arc isolation, and one-click HTML report export.
