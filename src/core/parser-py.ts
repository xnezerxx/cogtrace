import type {
  BindingKind,
  ParsedBinding,
  ParsedProgram,
  ScopeInfo,
  VarEvent
} from './types.js';

type PyTokenKind = 'ident' | 'keyword' | 'number' | 'string' | 'op' | 'punct';

interface PyToken {
  kind: PyTokenKind;
  value: string;
  line: number;
  column: number;
}

interface LogicalLine {
  indent: number;
  startLine: number;
  endLine: number;
  tokens: PyToken[];
}

interface PyStmtNode {
  indent: number;
  startLine: number;
  endLine: number;
  subtreeEndLine: number;
  tokens: PyToken[];
  children: PyStmtNode[];
}

const PY_KEYWORDS = new Set<string>([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'match',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield'
]);

const AUG_ASSIGN_OPS = new Set<string>([
  '+=',
  '-=',
  '*=',
  '/=',
  '//=',
  '%=',
  '**=',
  '&=',
  '|=',
  '^=',
  '>>=',
  '<<=',
  '@='
]);

const PY_MUTATING_METHODS = new Set<string>([
  'append',
  'extend',
  'insert',
  'pop',
  'popitem',
  'remove',
  'clear',
  'sort',
  'reverse',
  'update',
  'add',
  'discard',
  'setdefault'
]);

const MULTI_CHAR_OPS = [
  '//=',
  '**=',
  '>>=',
  '<<=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '@=',
  ':=',
  '==',
  '!=',
  '<=',
  '>=',
  '//',
  '**',
  '>>',
  '<<',
  '->'
];

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function tokenizeSnippet(
  snippet: string,
  baseLine: number,
  baseCol: number
): PyToken[] {
  const tokens: PyToken[] = [];
  let i = 0;
  let line = baseLine;
  let col = baseCol;

  const advance = (count = 1): void => {
    for (let k = 0; k < count; k++) {
      if (snippet[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < snippet.length) {
    const ch = snippet[i];

    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      advance();
      continue;
    }

    if (ch === '#') {
      while (i < snippet.length && snippet[i] !== '\n') advance();
      continue;
    }

    // String literal (including f/r/b/u prefixes)
    let prefixLen = 0;
    let isFString = false;
    if (/[rRbBuUfF]/.test(ch)) {
      let j = i;
      let prefix = '';
      while (j < snippet.length && prefix.length < 2 && /[rRbBuUfF]/.test(snippet[j])) {
        prefix += snippet[j];
        j++;
      }
      if (j < snippet.length && (snippet[j] === '"' || snippet[j] === "'")) {
        prefixLen = prefix.length;
        isFString = /[fF]/.test(prefix);
      }
    }

    if (prefixLen > 0 || ch === '"' || ch === "'") {
      const startLine = line;
      const startCol = col;
      advance(prefixLen);
      const quote = snippet[i];
      const isTriple = snippet.slice(i, i + 3) === quote.repeat(3);
      const delimLen = isTriple ? 3 : 1;
      advance(delimLen);
      const contentStart = i;
      const contentStartLine = line;
      const contentStartCol = col;

      while (i < snippet.length) {
        if (snippet[i] === '\\' && i + 1 < snippet.length) {
          advance(2);
          continue;
        }
        if (isTriple) {
          if (snippet.slice(i, i + 3) === quote.repeat(3)) {
            const rawContent = snippet.slice(contentStart, i);
            advance(3);
            if (isFString) {
              extractFStringTokens(rawContent, contentStartLine, contentStartCol, tokens);
            } else {
              tokens.push({ kind: 'string', value: '""', line: startLine, column: startCol });
            }
            break;
          }
        } else if (snippet[i] === quote || snippet[i] === '\n') {
          const rawContent = snippet.slice(contentStart, i);
          if (snippet[i] === quote) advance(1);
          if (isFString) {
            extractFStringTokens(rawContent, contentStartLine, contentStartCol, tokens);
          } else {
            tokens.push({ kind: 'string', value: '""', line: startLine, column: startCol });
          }
          break;
        }
        advance();
      }
      continue;
    }

    // Number
    if (/[0-9]/.test(ch)) {
      const startLine = line;
      const startCol = col;
      let num = '';
      while (i < snippet.length && /[0-9a-zA-Z_.]/.test(snippet[i])) {
        num += snippet[i];
        advance();
      }
      tokens.push({ kind: 'number', value: num, line: startLine, column: startCol });
      continue;
    }

    // Identifier / Keyword
    if (isIdentStart(ch)) {
      const startLine = line;
      const startCol = col;
      let word = '';
      while (i < snippet.length && isIdentPart(snippet[i])) {
        word += snippet[i];
        advance();
      }
      tokens.push({
        kind: PY_KEYWORDS.has(word) ? 'keyword' : 'ident',
        value: word,
        line: startLine,
        column: startCol
      });
      continue;
    }

    // Multi-char operators
    const matchedOp = MULTI_CHAR_OPS.find((op) => snippet.startsWith(op, i));
    if (matchedOp) {
      tokens.push({ kind: 'op', value: matchedOp, line, column: col });
      advance(matchedOp.length);
      continue;
    }

    // Single-char punctuation / operator
    if ('()[]{}:,.;@'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch, line, column: col });
      advance();
      continue;
    }

    if ('=+-*/%&|^~<>!'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, line, column: col });
      advance();
      continue;
    }

    advance();
  }

  return tokens;
}

function extractFStringTokens(
  content: string,
  baseLine: number,
  baseCol: number,
  out: PyToken[]
): void {
  out.push({ kind: 'string', value: 'f""', line: baseLine, column: baseCol });
  let i = 0;
  let line = baseLine;
  let col = baseCol;

  const step = (): void => {
    if (content[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    i++;
  };

  while (i < content.length) {
    if (content[i] === '{') {
      if (content[i + 1] === '{') {
        step();
        step();
        continue;
      }
      step(); // skip '{'
      const exprStart = i;
      const exprLine = line;
      const exprCol = col;
      let depth = 1;
      let exprEnd = i;
      let foundFormatSpec = false;

      while (i < content.length && depth > 0) {
        const c = content[i];
        if (c === '{' || c === '(' || c === '[') depth++;
        else if (c === '}' || c === ')' || c === ']') {
          depth--;
          if (depth === 0) {
            if (!foundFormatSpec) exprEnd = i;
            step();
            break;
          }
        } else if (depth === 1 && (c === ':' || c === '!') && !foundFormatSpec) {
          exprEnd = i;
          foundFormatSpec = true;
        }
        step();
      }

      const expr = content.slice(exprStart, exprEnd).trim();
      if (expr.length > 0) {
        const inner = tokenizeSnippet(expr, exprLine, exprCol);
        out.push(...inner);
      }
      continue;
    }
    step();
  }
}

function measureIndent(rawLine: string): number {
  let width = 0;
  for (let i = 0; i < rawLine.length; i++) {
    if (rawLine[i] === ' ') width += 1;
    else if (rawLine[i] === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

function buildLogicalLines(normalizedCode: string, sourceLines: string[]): LogicalLine[] {
  const allTokens = tokenizeSnippet(normalizedCode, 1, 1);
  // Group tokens by physical line
  const byLine = new Map<number, PyToken[]>();
  for (const tok of allTokens) {
    let arr = byLine.get(tok.line);
    if (!arr) {
      arr = [];
      byLine.set(tok.line, arr);
    }
    arr.push(tok);
  }

  const logical: LogicalLine[] = [];
  let current: LogicalLine | null = null;
  let bracketDepth = 0;

  for (let lineNum = 1; lineNum <= sourceLines.length; lineNum++) {
    const raw = sourceLines[lineNum - 1];
    const lineToks = byLine.get(lineNum) ?? [];
    const trimmed = raw.trim();

    if (current === null) {
      if (lineToks.length === 0) continue;
      current = {
        indent: measureIndent(raw),
        startLine: lineNum,
        endLine: lineNum,
        tokens: [...lineToks]
      };
    } else {
      current.endLine = lineNum;
      if (lineToks.length > 0) {
        current.tokens.push(...lineToks);
      }
    }

    for (const tok of lineToks) {
      if (tok.kind === 'punct') {
        if (tok.value === '(' || tok.value === '[' || tok.value === '{') bracketDepth++;
        else if (tok.value === ')' || tok.value === ']' || tok.value === '}') {
          bracketDepth = Math.max(0, bracketDepth - 1);
        }
      }
    }

    const hasBackslashCont = trimmed.endsWith('\\');
    if (bracketDepth === 0 && !hasBackslashCont) {
      // Split single-line semicolon statements
      const splitStmts = splitBySemicolon(current.tokens);
      for (const stmtTokens of splitStmts) {
        if (stmtTokens.length > 0) {
          logical.push({
            indent: current.indent,
            startLine: current.startLine,
            endLine: current.endLine,
            tokens: stmtTokens
          });
        }
      }
      current = null;
    }
  }

  if (current !== null && current.tokens.length > 0) {
    logical.push(current);
  }

  return logical;
}

function splitBySemicolon(tokens: PyToken[]): PyToken[][] {
  const parts: PyToken[][] = [];
  let curr: PyToken[] = [];
  let depth = 0;
  for (const tok of tokens) {
    if (tok.kind === 'punct' && (tok.value === '(' || tok.value === '[' || tok.value === '{')) {
      depth++;
      curr.push(tok);
    } else if (tok.kind === 'punct' && (tok.value === ')' || tok.value === ']' || tok.value === '}')) {
      depth = Math.max(0, depth - 1);
      curr.push(tok);
    } else if (tok.kind === 'punct' && tok.value === ';' && depth === 0) {
      if (curr.length > 0) parts.push(curr);
      curr = [];
    } else {
      curr.push(tok);
    }
  }
  if (curr.length > 0) parts.push(curr);
  return parts;
}

function buildStmtTree(logicalLines: LogicalLine[]): PyStmtNode[] {
  const roots: PyStmtNode[] = [];
  const stack: PyStmtNode[] = [];

  for (const ll of logicalLines) {
    const node: PyStmtNode = {
      indent: ll.indent,
      startLine: ll.startLine,
      endLine: ll.endLine,
      subtreeEndLine: ll.endLine,
      tokens: ll.tokens,
      children: []
    };

    while (stack.length > 0 && ll.indent <= stack[stack.length - 1].indent) {
      const finished = stack.pop()!;
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        parent.subtreeEndLine = Math.max(parent.subtreeEndLine, finished.subtreeEndLine);
      }
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      parent.subtreeEndLine = Math.max(parent.subtreeEndLine, node.subtreeEndLine);
    }

    stack.push(node);
  }

  while (stack.length > 0) {
    const finished = stack.pop()!;
    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      parent.subtreeEndLine = Math.max(parent.subtreeEndLine, finished.subtreeEndLine);
    }
  }

  return roots;
}

function findMatchingBracket(tokens: PyToken[], openIdx: number): number {
  const open = tokens[openIdx]?.value;
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return -1;
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].kind === 'punct' && tokens[i].value === open) depth++;
    else if (tokens[i].kind === 'punct' && tokens[i].value === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function findTopLevelToken(
  tokens: PyToken[],
  predicate: (tok: PyToken, idx: number) => boolean,
  start = 0,
  end = tokens.length
): number {
  let depth = 0;
  for (let i = start; i < end; i++) {
    const t = tokens[i];
    if (t.kind === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) {
      depth++;
    } else if (t.kind === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && predicate(t, i)) {
      return i;
    }
  }
  return -1;
}

function splitTopLevelCommas(tokens: PyToken[]): PyToken[][] {
  const result: PyToken[][] = [];
  let curr: PyToken[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) {
      depth++;
      curr.push(t);
    } else if (t.kind === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) {
      depth = Math.max(0, depth - 1);
      curr.push(t);
    } else if (t.kind === 'punct' && t.value === ',' && depth === 0) {
      result.push(curr);
      curr = [];
    } else {
      curr.push(t);
    }
  }
  if (curr.length > 0) result.push(curr);
  return result;
}

function splitHeaderAndInlineBody(tokens: PyToken[]): { header: PyToken[]; inlineBody: PyToken[] } {
  // Find the top-level ':' terminating a compound statement header (skipping lambda/dict/annotations)
  const colonIdx = findTopLevelToken(tokens, (t) => t.kind === 'punct' && t.value === ':');
  if (colonIdx === -1) return { header: tokens, inlineBody: [] };
  return {
    header: tokens.slice(0, colonIdx),
    inlineBody: tokens.slice(colonIdx + 1)
  };
}

export function parsePython(code: string): ParsedProgram {
  const normalizedCode = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sourceLines = normalizedCode.split('\n');
  const totalLines = sourceLines.length;

  const scopes = new Map<string, ScopeInfo>();
  const scopeBindings = new Map<string, Map<string, string>>();
  const scopeNonlocals = new Map<string, Set<string>>();
  const scopeGlobals = new Map<string, Set<string>>();
  const bindings = new Map<string, ParsedBinding>();
  const events: VarEvent[] = [];
  const lineNesting = new Array<number>(totalLines).fill(0);
  const lineControlFlow: string[][] = Array.from({ length: totalLines }, () => []);

  let scopeSeq = 0;
  let bindingSeq = 0;

  function createScope(
    parentId: string | null,
    kind: ScopeInfo['kind'],
    startLine: number,
    endLine: number,
    isFunctionBoundary: boolean
  ): ScopeInfo {
    const id = `scope_${scopeSeq++}`;
    const parent = parentId ? scopes.get(parentId) : undefined;
    const depth = parent ? parent.depth + 1 : 0;
    const functionBoundaryId = isFunctionBoundary
      ? id
      : (parent?.functionBoundaryId ?? id);
    const info: ScopeInfo = {
      id,
      parentId,
      kind,
      depth,
      functionBoundaryId,
      startLine,
      endLine
    };
    scopes.set(id, info);
    scopeBindings.set(id, new Map<string, string>());
    scopeNonlocals.set(id, new Set<string>());
    scopeGlobals.set(id, new Set<string>());
    return info;
  }

  function resolveBinding(scopeId: string, name: string): ParsedBinding | undefined {
    let curr: string | null = scopeId;
    while (curr !== null) {
      const id = scopeBindings.get(curr)?.get(name);
      if (id) return bindings.get(id);
      curr = scopes.get(curr)?.parentId ?? null;
    }
    return undefined;
  }

  function resolveOuterBinding(scopeId: string, name: string): ParsedBinding | undefined {
    const parentId = scopes.get(scopeId)?.parentId ?? null;
    if (!parentId) return undefined;
    return resolveBinding(parentId, name);
  }

  function hasAncestorBinding(scopeId: string, name: string): boolean {
    return resolveOuterBinding(scopeId, name) !== undefined;
  }

  function declareOrWriteBinding(
    tok: PyToken,
    scopeId: string,
    kind: BindingKind,
    forceDeclareInScope = false
  ): ParsedBinding {
    const name = tok.value;

    // Respect `global` and `nonlocal` declarations in Python functions
    if (!forceDeclareInScope) {
      if (scopeGlobals.get(scopeId)?.has(name)) {
        const modId = 'scope_0';
        const existingGlobal = scopeBindings.get(modId)?.get(name);
        if (existingGlobal) {
          events.push({
            kind: 'write',
            line: tok.line,
            column: tok.column,
            varId: existingGlobal,
            name,
            scopeId
          });
          return bindings.get(existingGlobal)!;
        }
        return declareBindingInScope(tok, modId, kind);
      }
      if (scopeNonlocals.get(scopeId)?.has(name)) {
        const outer = resolveOuterBinding(scopeId, name);
        if (outer) {
          events.push({
            kind: 'write',
            line: tok.line,
            column: tok.column,
            varId: outer.id,
            name,
            scopeId
          });
          return outer;
        }
      }
    }

    const table = scopeBindings.get(scopeId)!;
    const existingId = table.get(name);
    if (existingId && !forceDeclareInScope) {
      events.push({
        kind: 'write',
        line: tok.line,
        column: tok.column,
        varId: existingId,
        name,
        scopeId
      });
      return bindings.get(existingId)!;
    }

    return declareBindingInScope(tok, scopeId, kind);
  }

  function declareBindingInScope(
    tok: PyToken,
    scopeId: string,
    kind: BindingKind
  ): ParsedBinding {
    const scope = scopes.get(scopeId)!;
    const table = scopeBindings.get(scopeId)!;
    const existingId = table.get(tok.value);
    if (existingId) {
      return bindings.get(existingId)!;
    }
    const isShadowed = hasAncestorBinding(scopeId, tok.value);
    const id = `var_${bindingSeq++}_${tok.value}`;
    const binding: ParsedBinding = {
      id,
      name: tok.value,
      scopeId,
      scopeDepth: scope.depth,
      functionBoundaryId: scope.functionBoundaryId,
      defLine: tok.line,
      defColumn: tok.column,
      kind,
      isShadowed
    };
    bindings.set(id, binding);
    table.set(tok.value, id);
    events.push({
      kind: 'def',
      line: tok.line,
      column: tok.column,
      varId: id,
      name: tok.value,
      scopeId
    });
    return binding;
  }

  function recordRead(tok: PyToken, scopeId: string): void {
    const binding = resolveBinding(scopeId, tok.value);
    if (!binding) return;
    events.push({
      kind: 'read',
      line: tok.line,
      column: tok.column,
      varId: binding.id,
      name: binding.name,
      scopeId
    });
  }

  function recordWrite(tok: PyToken, scopeId: string, isPropertyMutation = false): void {
    const binding = resolveBinding(scopeId, tok.value);
    if (!binding) return;
    events.push({
      kind: 'write',
      line: tok.line,
      column: tok.column,
      varId: binding.id,
      name: binding.name,
      scopeId,
      isPropertyMutation
    });
  }

  function addControlFlow(line: number, tag: string): void {
    const idx = line - 1;
    if (idx >= 0 && idx < totalLines && !lineControlFlow[idx].includes(tag)) {
      lineControlFlow[idx].push(tag);
    }
  }

  function markNesting(startLine: number, endLine: number, depth: number): void {
    const from = Math.max(1, startLine);
    const to = Math.min(totalLines, endLine);
    for (let l = from; l <= to; l++) {
      if (depth > lineNesting[l - 1]) {
        lineNesting[l - 1] = depth;
      }
    }
  }

  function prescanNonlocalGlobal(children: PyStmtNode[], scopeId: string): void {
    const walk = (nodes: PyStmtNode[]): void => {
      for (const n of nodes) {
        const first = n.tokens[0];
        if (!first) continue;
        if (
          first.kind === 'keyword' &&
          (first.value === 'def' ||
            first.value === 'class' ||
            (first.value === 'async' && n.tokens[1]?.value === 'def'))
        ) {
          continue; // Don't cross into nested def/class
        }
        if (first.kind === 'keyword' && first.value === 'nonlocal') {
          for (const t of n.tokens.slice(1)) {
            if (t.kind === 'ident') scopeNonlocals.get(scopeId)!.add(t.value);
          }
        } else if (first.kind === 'keyword' && first.value === 'global') {
          for (const t of n.tokens.slice(1)) {
            if (t.kind === 'ident') scopeGlobals.get(scopeId)!.add(t.value);
          }
        }
        if (n.children.length > 0) walk(n.children);
      }
    };
    walk(children);
  }

  function bindTargetTokens(
    targetTokens: PyToken[],
    scopeId: string,
    kind: BindingKind,
    forceDeclare = false
  ): void {
    if (targetTokens.length === 0) return;
    // Strip outer parens/brackets if wrapping tuple/list unpacking
    if (
      targetTokens.length >= 2 &&
      ((targetTokens[0].value === '(' &&
        findMatchingBracket(targetTokens, 0) === targetTokens.length - 1) ||
        (targetTokens[0].value === '[' &&
          findMatchingBracket(targetTokens, 0) === targetTokens.length - 1))
    ) {
      bindTargetTokens(targetTokens.slice(1, -1), scopeId, kind, forceDeclare);
      return;
    }

    const parts = splitTopLevelCommas(targetTokens);
    if (parts.length > 1) {
      for (const part of parts) {
        if (part.length > 0) bindTargetTokens(part, scopeId, kind, forceDeclare);
      }
      return;
    }

    // Strip starred unpacking `*rest`
    let toks = targetTokens;
    if (toks[0]?.kind === 'op' && toks[0].value === '*') {
      toks = toks.slice(1);
    }
    if (toks.length === 0) return;

    // Simple identifier binding
    if (toks.length === 1 && toks[0].kind === 'ident') {
      declareOrWriteBinding(toks[0], scopeId, kind, forceDeclare);
      return;
    }

    // Attribute or subscript mutation: `obj.attr = ...` or `arr[idx] = ...`
    if (toks[0].kind === 'ident') {
      // Visit any subscript expressions inside `[...]` for reads
      for (let i = 1; i < toks.length; i++) {
        if (toks[i].kind === 'punct' && toks[i].value === '[') {
          const closeIdx = findMatchingBracket(toks, i);
          visitExprTokens(toks.slice(i + 1, closeIdx), scopeId);
          i = closeIdx;
        }
      }
      recordWrite(toks[0], scopeId, true);
    }
  }

  function visitLambda(tokens: PyToken[], startIdx: number, scopeId: string): number {
    // `lambda a, b=default: expr`
    const colonIdx = findTopLevelToken(tokens, (t) => t.kind === 'punct' && t.value === ':', startIdx + 1);
    if (colonIdx === -1) return tokens.length;

    const endLine = tokens[tokens.length - 1]?.line ?? tokens[startIdx].line;
    const lambdaScope = createScope(
      scopeId,
      'function',
      tokens[startIdx].line,
      endLine,
      true
    );

    const paramTokens = tokens.slice(startIdx + 1, colonIdx);
    const params = splitTopLevelCommas(paramTokens);
    for (const p of params) {
      if (p.length === 0) continue;
      let idx = 0;
      if (p[idx]?.kind === 'op' && (p[idx].value === '*' || p[idx].value === '**')) idx++;
      const nameTok = p[idx];
      const eqIdx = findTopLevelToken(p, (t) => t.kind === 'op' && t.value === '=');
      if (eqIdx !== -1) {
        visitExprTokens(p.slice(eqIdx + 1), scopeId);
      }
      if (nameTok && nameTok.kind === 'ident') {
        declareBindingInScope(nameTok, lambdaScope.id, 'param');
      }
    }

    // Body extends to end of slice (caller slices at comma/bracket boundary when needed)
    const bodyEnd = findTopLevelToken(
      tokens,
      (t) => t.kind === 'punct' && t.value === ',',
      colonIdx + 1
    );
    const bodySlice = bodyEnd === -1 ? tokens.slice(colonIdx + 1) : tokens.slice(colonIdx + 1, bodyEnd);
    visitExprTokens(bodySlice, lambdaScope.id);
    return bodyEnd === -1 ? tokens.length : bodyEnd;
  }

  function tryVisitComprehension(inner: PyToken[], scopeId: string): boolean {
    const firstForIdx = findTopLevelToken(
      inner,
      (t) => t.kind === 'keyword' && t.value === 'for'
    );
    if (firstForIdx === -1) return false;

    const startLine = inner[0]?.line ?? 1;
    const endLine = inner[inner.length - 1]?.line ?? startLine;
    const compScope = createScope(scopeId, 'comprehension', startLine, endLine, false);

    // Parse one or more `for target in iter [if cond ...]` clauses
    const outputExpr = inner.slice(0, firstForIdx);
    let cursor = firstForIdx;
    let clauseIndex = 0;

    while (cursor < inner.length) {
      if (inner[cursor]?.kind === 'keyword' && inner[cursor].value === 'async') {
        cursor++;
      }
      if (inner[cursor]?.kind !== 'keyword' || inner[cursor].value !== 'for') {
        break;
      }
      const inIdx = findTopLevelToken(
        inner,
        (t) => t.kind === 'keyword' && t.value === 'in',
        cursor + 1
      );
      if (inIdx === -1) break;
      const targetToks = inner.slice(cursor + 1, inIdx);

      // Find end of iter expression: next top-level `if`, `for`, or `async`
      let nextClause = findTopLevelToken(
        inner,
        (t) =>
          t.kind === 'keyword' &&
          (t.value === 'if' || t.value === 'for' || t.value === 'async'),
        inIdx + 1
      );
      if (nextClause === -1) nextClause = inner.length;

      const iterToks = inner.slice(inIdx + 1, nextClause);
      // First comprehension iterable is evaluated in outer scope; nested ones in compScope
      visitExprTokens(iterToks, clauseIndex === 0 ? scopeId : compScope.id);
      bindTargetTokens(targetToks, compScope.id, 'comprehension', true);

      cursor = nextClause;
      while (cursor < inner.length && inner[cursor]?.kind === 'keyword' && inner[cursor].value === 'if') {
        let nextAfterIf = findTopLevelToken(
          inner,
          (t) =>
            t.kind === 'keyword' &&
            (t.value === 'if' || t.value === 'for' || t.value === 'async'),
          cursor + 1
        );
        if (nextAfterIf === -1) nextAfterIf = inner.length;
        visitExprTokens(inner.slice(cursor + 1, nextAfterIf), compScope.id);
        cursor = nextAfterIf;
      }

      clauseIndex++;
    }

    visitExprTokens(outputExpr, compScope.id);
    return true;
  }

  function visitExprTokens(tokens: PyToken[], scopeId: string): void {
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];

      // Lambda expression
      if (tok.kind === 'keyword' && tok.value === 'lambda') {
        i = visitLambda(tokens, i, scopeId);
        continue;
      }

      // Bracketed group — check for list/set/dict/generator comprehension
      if (tok.kind === 'punct' && (tok.value === '[' || tok.value === '{' || tok.value === '(')) {
        const closeIdx = findMatchingBracket(tokens, i);
        const inner = tokens.slice(i + 1, closeIdx);
        const isCallArgs =
          tok.value === '(' &&
          i > 0 &&
          (tokens[i - 1].kind === 'ident' ||
            tokens[i - 1].value === ')' ||
            tokens[i - 1].value === ']');

        if (isCallArgs) {
          // Handle keyword arguments `fn(key=val)` so `key` isn't mistaken for a local read
          const args = splitTopLevelCommas(inner);
          for (const arg of args) {
            if (
              arg.length >= 2 &&
              arg[0].kind === 'ident' &&
              arg[1].kind === 'op' &&
              arg[1].value === '='
            ) {
              visitExprTokens(arg.slice(2), scopeId);
            } else {
              visitExprTokens(arg, scopeId);
            }
          }
        } else if (!tryVisitComprehension(inner, scopeId)) {
          visitExprTokens(inner, scopeId);
        }
        i = closeIdx + 1;
        continue;
      }

      // Walrus operator `name := expr`
      if (
        tok.kind === 'ident' &&
        tokens[i + 1]?.kind === 'op' &&
        tokens[i + 1].value === ':='
      ) {
        // Evaluate rest up to next comma/closing boundary
        const restEnd = findTopLevelToken(
          tokens,
          (t) => t.kind === 'punct' && t.value === ',',
          i + 2
        );
        const rhsEnd = restEnd === -1 ? tokens.length : restEnd;
        visitExprTokens(tokens.slice(i + 2, rhsEnd), scopeId);
        // Walrus binds into enclosing non-comprehension scope
        let targetScopeId = scopeId;
        while (
          scopes.get(targetScopeId)?.kind === 'comprehension' &&
          scopes.get(targetScopeId)?.parentId
        ) {
          targetScopeId = scopes.get(targetScopeId)!.parentId!;
        }
        declareOrWriteBinding(tok, targetScopeId, 'var');
        i = rhsEnd;
        continue;
      }

      // Attribute access & mutating method call detection (`obj.append(x)`)
      if (tok.kind === 'ident') {
        // Skip attribute names preceded by `.`
        if (i > 0 && tokens[i - 1].kind === 'punct' && tokens[i - 1].value === '.') {
          i++;
          continue;
        }

        // Check for mutating method call chain `obj.method(...)` or `obj.prop.append(...)`
        let look = i + 1;
        let lastAttr: PyToken | null = null;
        while (look < tokens.length) {
          if (tokens[look].kind === 'punct' && tokens[look].value === '.') {
            if (tokens[look + 1]?.kind === 'ident') {
              lastAttr = tokens[look + 1];
              look += 2;
              continue;
            }
            break;
          }
          if (tokens[look].kind === 'punct' && tokens[look].value === '[') {
            const closeIdx = findMatchingBracket(tokens, look);
            visitExprTokens(tokens.slice(look + 1, closeIdx), scopeId);
            look = closeIdx + 1;
            continue;
          }
          break;
        }

        if (
          lastAttr &&
          PY_MUTATING_METHODS.has(lastAttr.value) &&
          tokens[look]?.kind === 'punct' &&
          tokens[look].value === '('
        ) {
          recordWrite(tok, scopeId, true);
          const closeArgs = findMatchingBracket(tokens, look);
          const argSlice = tokens.slice(look + 1, closeArgs);
          const args = splitTopLevelCommas(argSlice);
          for (const arg of args) {
            if (
              arg.length >= 2 &&
              arg[0].kind === 'ident' &&
              arg[1].kind === 'op' &&
              arg[1].value === '='
            ) {
              visitExprTokens(arg.slice(2), scopeId);
            } else {
              visitExprTokens(arg, scopeId);
            }
          }
          i = closeArgs + 1;
          continue;
        }

        recordRead(tok, scopeId);
      }

      i++;
    }
  }

  function visitSimpleTokens(
    tokens: PyToken[],
    scopeId: string,
    isTerminalReturn: boolean
  ): void {
    if (tokens.length === 0) return;
    const first = tokens[0];

    if (first.kind === 'keyword') {
      if (first.value === 'pass' || first.value === 'global' || first.value === 'nonlocal') {
        return;
      }
      if (first.value === 'break') {
        addControlFlow(first.line, 'break');
        return;
      }
      if (first.value === 'continue') {
        addControlFlow(first.line, 'continue');
        return;
      }
      if (first.value === 'raise') {
        addControlFlow(first.line, 'throw');
        visitExprTokens(tokens.slice(1), scopeId);
        return;
      }
      if (first.value === 'return') {
        if (!isTerminalReturn) {
          addControlFlow(first.line, 'early-return');
        }
        visitExprTokens(tokens.slice(1), scopeId);
        return;
      }
      if (first.value === 'import') {
        const items = splitTopLevelCommas(tokens.slice(1));
        for (const item of items) {
          const asIdx = item.findIndex((t) => t.kind === 'keyword' && t.value === 'as');
          const bindTok = asIdx !== -1 ? item[asIdx + 1] : item[0];
          if (bindTok && bindTok.kind === 'ident') {
            declareBindingInScope(bindTok, scopeId, 'import');
          }
        }
        return;
      }
      if (first.value === 'from') {
        const impIdx = tokens.findIndex((t) => t.kind === 'keyword' && t.value === 'import');
        if (impIdx !== -1) {
          let importList = tokens.slice(impIdx + 1);
          if (importList[0]?.value === '(' && importList[importList.length - 1]?.value === ')') {
            importList = importList.slice(1, -1);
          }
          const items = splitTopLevelCommas(importList);
          for (const item of items) {
            const asIdx = item.findIndex((t) => t.kind === 'keyword' && t.value === 'as');
            const bindTok = asIdx !== -1 ? item[asIdx + 1] : item[0];
            if (bindTok && bindTok.kind === 'ident') {
              declareBindingInScope(bindTok, scopeId, 'import');
            }
          }
        }
        return;
      }
      if (first.value === 'del') {
        const parts = splitTopLevelCommas(tokens.slice(1));
        for (const part of parts) {
          if (part[0]?.kind === 'ident') {
            const isSubscriptOrAttr = part.length > 1;
            for (let j = 1; j < part.length; j++) {
              if (part[j].kind === 'punct' && part[j].value === '[') {
                const closeIdx = findMatchingBracket(part, j);
                visitExprTokens(part.slice(j + 1, closeIdx), scopeId);
                j = closeIdx;
              }
            }
            recordWrite(part[0], scopeId, isSubscriptOrAttr);
          }
        }
        return;
      }
      if (first.value === 'assert' || first.value === 'yield') {
        visitExprTokens(tokens.slice(1), scopeId);
        return;
      }
    }

    // Augmented assignment: `x += expr`, `d[k] += expr`
    const augIdx = findTopLevelToken(
      tokens,
      (t) => t.kind === 'op' && AUG_ASSIGN_OPS.has(t.value)
    );
    if (augIdx !== -1) {
      const lhs = tokens.slice(0, augIdx);
      const rhs = tokens.slice(augIdx + 1);
      visitExprTokens(rhs, scopeId);
      if (lhs.length === 1 && lhs[0].kind === 'ident') {
        recordRead(lhs[0], scopeId);
        declareOrWriteBinding(lhs[0], scopeId, 'var');
      } else if (lhs[0]?.kind === 'ident') {
        for (let j = 1; j < lhs.length; j++) {
          if (lhs[j].kind === 'punct' && lhs[j].value === '[') {
            const closeIdx = findMatchingBracket(lhs, j);
            visitExprTokens(lhs.slice(j + 1, closeIdx), scopeId);
            j = closeIdx;
          }
        }
        recordRead(lhs[0], scopeId);
        recordWrite(lhs[0], scopeId, true);
      }
      return;
    }

    // Regular assignment or annotated assignment: `a = b = expr` or `x: int = expr`
    const eqIndices: number[] = [];
    {
      let depth = 0;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.kind === 'punct' && (t.value === '(' || t.value === '[' || t.value === '{')) depth++;
        else if (t.kind === 'punct' && (t.value === ')' || t.value === ']' || t.value === '}')) {
          depth = Math.max(0, depth - 1);
        } else if (depth === 0 && t.kind === 'op' && t.value === '=') {
          eqIndices.push(i);
        }
      }
    }

    if (eqIndices.length > 0) {
      const lastEq = eqIndices[eqIndices.length - 1];
      const rhs = tokens.slice(lastEq + 1);
      visitExprTokens(rhs, scopeId);

      let prevStart = 0;
      for (const eqIdx of eqIndices) {
        let lhs = tokens.slice(prevStart, eqIdx);
        // Handle type annotation `x: Type = expr`
        const colonIdx = findTopLevelToken(lhs, (t) => t.kind === 'punct' && t.value === ':');
        if (colonIdx !== -1) {
          lhs = lhs.slice(0, colonIdx);
        }
        bindTargetTokens(lhs, scopeId, 'var');
        prevStart = eqIdx + 1;
      }
      return;
    }

    // Type-only annotated declaration without initializer: `x: int`
    const annColon = findTopLevelToken(tokens, (t) => t.kind === 'punct' && t.value === ':');
    if (annColon === 1 && tokens[0].kind === 'ident') {
      declareBindingInScope(tokens[0], scopeId, 'var');
      return;
    }

    // Otherwise treat as expression statement
    visitExprTokens(tokens, scopeId);
  }

  function visitStatement(
    stmt: PyStmtNode,
    scopeId: string,
    nesting: number,
    terminalReturnNode: PyStmtNode | null
  ): void {
    const tokens = stmt.tokens;
    if (tokens.length === 0) return;

    // Decorator line `@decorator(arg)`
    if (tokens[0].kind === 'punct' && tokens[0].value === '@') {
      visitExprTokens(tokens.slice(1), scopeId);
      return;
    }

    let kwIdx = 0;
    if (tokens[0].kind === 'keyword' && tokens[0].value === 'async') {
      kwIdx = 1;
    }
    const kw = tokens[kwIdx];

    // `def name(params):`
    if (kw?.kind === 'keyword' && kw.value === 'def') {
      const nameTok = tokens[kwIdx + 1];
      if (nameTok && nameTok.kind === 'ident') {
        declareBindingInScope(nameTok, scopeId, 'function');
      }
      const parentScope = scopes.get(scopeId)!;
      const isNested = parentScope.depth > 0 || nesting > 0;
      const fnNesting = isNested ? nesting + 1 : nesting;
      const fnScope = createScope(
        scopeId,
        'function',
        stmt.startLine,
        stmt.subtreeEndLine,
        true
      );
      prescanNonlocalGlobal(stmt.children, fnScope.id);

      const openParen = tokens.findIndex((t) => t.kind === 'punct' && t.value === '(');
      if (openParen !== -1) {
        const closeParen = findMatchingBracket(tokens, openParen);
        const paramTokens = tokens.slice(openParen + 1, closeParen);
        const params = splitTopLevelCommas(paramTokens);
        for (const p of params) {
          if (p.length === 0) continue;
          let idx = 0;
          if (p[idx]?.kind === 'op' && (p[idx].value === '*' || p[idx].value === '**')) idx++;
          if (p[idx]?.kind === 'op' && p[idx].value === '/') continue;
          const pName = p[idx];
          const eqIdx = findTopLevelToken(p, (t) => t.kind === 'op' && t.value === '=');
          if (eqIdx !== -1) {
            visitExprTokens(p.slice(eqIdx + 1), scopeId);
          }
          if (pName && pName.kind === 'ident') {
            declareBindingInScope(pName, fnScope.id, 'param');
          }
        }
      }

      if (isNested && stmt.subtreeEndLine > stmt.startLine) {
        markNesting(stmt.startLine + 1, stmt.subtreeEndLine, fnNesting);
      }

      const { inlineBody } = splitHeaderAndInlineBody(tokens);
      if (inlineBody.length > 0) {
        visitSimpleTokens(inlineBody, fnScope.id, true);
      }

      const lastChild = stmt.children[stmt.children.length - 1] ?? null;
      const termRet =
        lastChild && lastChild.tokens[0]?.kind === 'keyword' && lastChild.tokens[0].value === 'return'
          ? lastChild
          : null;

      for (const child of stmt.children) {
        visitStatement(child, fnScope.id, fnNesting, termRet);
      }
      return;
    }

    // `class Name(Bases):`
    if (kw?.kind === 'keyword' && kw.value === 'class') {
      const nameTok = tokens[kwIdx + 1];
      if (nameTok && nameTok.kind === 'ident') {
        declareBindingInScope(nameTok, scopeId, 'class');
      }
      const openParen = tokens.findIndex((t) => t.kind === 'punct' && t.value === '(');
      if (openParen !== -1) {
        const closeParen = findMatchingBracket(tokens, openParen);
        visitExprTokens(tokens.slice(openParen + 1, closeParen), scopeId);
      }
      const clsScope = createScope(
        scopeId,
        'class',
        stmt.startLine,
        stmt.subtreeEndLine,
        false
      );
      for (const child of stmt.children) {
        visitStatement(child, clsScope.id, nesting, null);
      }
      return;
    }

    // `for target in iter:`
    if (kw?.kind === 'keyword' && kw.value === 'for') {
      const { header, inlineBody } = splitHeaderAndInlineBody(tokens);
      const inIdx = findTopLevelToken(
        header,
        (t) => t.kind === 'keyword' && t.value === 'in',
        kwIdx + 1
      );
      if (inIdx !== -1) {
        const targetToks = header.slice(kwIdx + 1, inIdx);
        const iterToks = header.slice(inIdx + 1);
        visitExprTokens(iterToks, scopeId);
        bindTargetTokens(targetToks, scopeId, 'loop');
      }
      if (stmt.children.length > 0) {
        markNesting(stmt.children[0].startLine, stmt.subtreeEndLine, nesting + 1);
      }
      if (inlineBody.length > 0) {
        visitSimpleTokens(inlineBody, scopeId, false);
      }
      for (const child of stmt.children) {
        visitStatement(child, scopeId, nesting + 1, null);
      }
      return;
    }

    // `with expr as target:`
    if (kw?.kind === 'keyword' && kw.value === 'with') {
      const { header, inlineBody } = splitHeaderAndInlineBody(tokens);
      const items = splitTopLevelCommas(header.slice(kwIdx + 1));
      for (const item of items) {
        const asIdx = findTopLevelToken(item, (t) => t.kind === 'keyword' && t.value === 'as');
        if (asIdx !== -1) {
          visitExprTokens(item.slice(0, asIdx), scopeId);
          bindTargetTokens(item.slice(asIdx + 1), scopeId, 'var');
        } else {
          visitExprTokens(item, scopeId);
        }
      }
      if (stmt.children.length > 0) {
        markNesting(stmt.children[0].startLine, stmt.subtreeEndLine, nesting + 1);
      }
      if (inlineBody.length > 0) {
        visitSimpleTokens(inlineBody, scopeId, false);
      }
      for (const child of stmt.children) {
        visitStatement(child, scopeId, nesting + 1, null);
      }
      return;
    }

    // `try:` / `except Exc as err:` / `finally:`
    if (
      kw?.kind === 'keyword' &&
      (kw.value === 'try' || kw.value === 'except' || kw.value === 'finally')
    ) {
      const { header, inlineBody } = splitHeaderAndInlineBody(tokens);
      if (kw.value === 'except') {
        addControlFlow(stmt.startLine, 'catch');
        const asIdx = findTopLevelToken(header, (t) => t.kind === 'keyword' && t.value === 'as');
        if (asIdx !== -1) {
          visitExprTokens(header.slice(kwIdx + 1, asIdx), scopeId);
          bindTargetTokens(header.slice(asIdx + 1), scopeId, 'catch');
        } else {
          visitExprTokens(header.slice(kwIdx + 1), scopeId);
        }
      }
      if (stmt.children.length > 0) {
        markNesting(stmt.children[0].startLine, stmt.subtreeEndLine, nesting + 1);
      }
      if (inlineBody.length > 0) {
        visitSimpleTokens(inlineBody, scopeId, false);
      }
      for (const child of stmt.children) {
        visitStatement(child, scopeId, nesting + 1, null);
      }
      return;
    }

    // `if` / `elif` / `else` / `while` / `match` / `case`
    if (
      kw?.kind === 'keyword' &&
      (kw.value === 'if' ||
        kw.value === 'elif' ||
        kw.value === 'else' ||
        kw.value === 'while' ||
        kw.value === 'match' ||
        kw.value === 'case')
    ) {
      const { header, inlineBody } = splitHeaderAndInlineBody(tokens);
      if (kw.value !== 'else') {
        visitExprTokens(header.slice(kwIdx + 1), scopeId);
      }
      if (stmt.children.length > 0) {
        markNesting(stmt.children[0].startLine, stmt.subtreeEndLine, nesting + 1);
      }
      if (inlineBody.length > 0) {
        visitSimpleTokens(inlineBody, scopeId, false);
      }
      for (const child of stmt.children) {
        visitStatement(child, scopeId, nesting + 1, null);
      }
      return;
    }

    // Regular simple statement
    visitSimpleTokens(tokens, scopeId, stmt === terminalReturnNode);
  }

  const rootScope = createScope(null, 'module', 1, Math.max(1, totalLines), true);
  const logicalLines = buildLogicalLines(normalizedCode, sourceLines);
  const tree = buildStmtTree(logicalLines);

  for (const stmt of tree) {
    visitStatement(stmt, rootScope.id, 0, null);
  }

  return {
    language: 'python',
    sourceLines,
    scopes,
    bindings,
    events,
    lineNesting,
    lineControlFlow
  };
}
