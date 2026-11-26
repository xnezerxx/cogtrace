# Contributing to CogTrace

Thank you for considering contributing to **CogTrace**! Contributions of all kinds — bug reports, cognitive-model refinements, new language parsers, CLI ergonomics, web studio UX polish, and tests — are warmly welcomed.

## Development Setup

```bash
git clone https://github.com/xnezerxx/cogtrace.git
cd cogtrace
npm install
```

### Useful Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server for the Interactive Web X-Ray Studio |
| `npm run typecheck` | Run strict TypeScript typechecking (`tsc --noEmit`) |
| `npm test` | Run the full Vitest test suite |
| `npm run build` | Build both the Node.js CLI (`dist/cli`, `dist/core`) and Web Studio (`dist/web`) |
| `npm run cli -- analyze src/core/simulator.ts` | Run the CLI directly via `tsx` |

## Project Structure

- `src/core/` — Pure TypeScript AST parsers (`parser-ts.ts`, `parser-py.ts`), Working-Memory Simulator (`simulator.ts`), and self-contained HTML report generator (`html-report.ts`). Must remain 100% browser-compatible (no Node.js `fs`/`path` imports).
- `src/cli/` — Node.js CLI commands (`analyze`, `check`, `diff`, `report`) and ANSI terminal formatter.
- `src/web/` — Interactive Web X-Ray Studio deployed to GitHub Pages.
- `tests/` — Vitest unit and integration tests covering parsers, simulator math, HTML report safety, and CLI commands.

## Pull Request Guidelines

1. Keep `src/core/` strictly isomorphic (zero Node-only built-ins) so every feature works identically in both the CLI and the browser.
2. Add or update unit tests in `tests/` for every new analyzer rule, parser edge case, or CLI flag.
3. Ensure `npm run typecheck`, `npm test`, and `npm run build` all pass cleanly with exit code `0`.
4. Use clear, concise commit messages (e.g., `feat(py): handle walrus operator inside comprehensions`).
5. Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
