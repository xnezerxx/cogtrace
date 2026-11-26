import ts from 'typescript';
import type {
  BindingKind,
  Language,
  ParsedBinding,
  ParsedProgram,
  ScopeInfo,
  VarEvent
} from './types.js';

const COMPOUND_ASSIGNMENT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
]);

const MUTATING_METHODS = new Set<string>([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'delete',
  'clear',
  'add'
]);

function inferScriptKind(fileName: string, language: Language, code: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) {
    return ts.ScriptKind.TS;
  }
  if (language === 'javascript') {
    return /<[A-Za-z][A-Za-z0-9]*[\s/>]/.test(code) ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
  }
  return /<[A-Z][A-Za-z0-9]*[\s/>]/.test(code) && /<\/[A-Za-z]|\/>/.test(code)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
}

export function parseTypeScriptOrJavaScript(
  code: string,
  language: 'typescript' | 'javascript' = 'typescript',
  fileName = language === 'typescript' ? 'input.ts' : 'input.js'
): ParsedProgram {
  const normalizedCode = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const sourceLines = normalizedCode.split('\n');
  const totalLines = sourceLines.length;
  const scriptKind = inferScriptKind(fileName, language, normalizedCode);
  const sourceFile = ts.createSourceFile(
    fileName,
    normalizedCode,
    ts.ScriptTarget.Latest,
    true,
    scriptKind
  );

  const scopes = new Map<string, ScopeInfo>();
  const scopeBindings = new Map<string, Map<string, string>>();
  const bindings = new Map<string, ParsedBinding>();
  const events: VarEvent[] = [];
  const lineNesting = new Array<number>(totalLines).fill(0);
  const lineControlFlow: string[][] = Array.from({ length: totalLines }, () => []);

  let scopeSeq = 0;
  let bindingSeq = 0;

  function getLineCol(node: ts.Node): { line: number; column: number } {
    const start = node.getStart(sourceFile);
    const lc = sourceFile.getLineAndCharacterOfPosition(start);
    return { line: lc.line + 1, column: lc.character + 1 };
  }

  function getEndLine(node: ts.Node): number {
    const start = node.getStart(sourceFile);
    const end = Math.max(start, node.getEnd() - 1);
    return sourceFile.getLineAndCharacterOfPosition(end).line + 1;
  }

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
    return info;
  }

  function resolveBinding(scopeId: string, name: string): ParsedBinding | undefined {
    let curr: string | null = scopeId;
    while (curr !== null) {
      const table = scopeBindings.get(curr);
      const id = table?.get(name);
      if (id) return bindings.get(id);
      curr = scopes.get(curr)?.parentId ?? null;
    }
    return undefined;
  }

  function hasAncestorBinding(scopeId: string, name: string): boolean {
    let curr: string | null = scopes.get(scopeId)?.parentId ?? null;
    while (curr !== null) {
      if (scopeBindings.get(curr)?.has(name)) return true;
      curr = scopes.get(curr)?.parentId ?? null;
    }
    return false;
  }

  function declareBinding(
    name: string,
    node: ts.Node,
    scopeId: string,
    kind: BindingKind
  ): ParsedBinding {
    const scope = scopes.get(scopeId)!;
    const targetScopeId = kind === 'var' ? scope.functionBoundaryId : scopeId;
    const targetScope = scopes.get(targetScopeId)!;
    const table = scopeBindings.get(targetScopeId)!;

    // If re-declaring in exact same scope (e.g. `var x = 1; var x = 2;`), reuse binding.
    const existingId = table.get(name);
    if (existingId) {
      return bindings.get(existingId)!;
    }

    const { line, column } = getLineCol(node);
    const isShadowed = hasAncestorBinding(targetScopeId, name);
    const id = `var_${bindingSeq++}_${name}`;
    const binding: ParsedBinding = {
      id,
      name,
      scopeId: targetScopeId,
      scopeDepth: targetScope.depth,
      functionBoundaryId: targetScope.functionBoundaryId,
      defLine: line,
      defColumn: column,
      kind,
      isShadowed
    };
    bindings.set(id, binding);
    table.set(name, id);
    events.push({
      kind: 'def',
      line,
      column,
      varId: id,
      name,
      scopeId: targetScopeId
    });
    return binding;
  }

  function recordRead(ident: ts.Identifier, scopeId: string): void {
    const binding = resolveBinding(scopeId, ident.text);
    if (!binding) return;
    const { line, column } = getLineCol(ident);
    events.push({
      kind: 'read',
      line,
      column,
      varId: binding.id,
      name: binding.name,
      scopeId
    });
  }

  function recordWrite(
    ident: ts.Identifier,
    scopeId: string,
    isPropertyMutation = false
  ): void {
    const binding = resolveBinding(scopeId, ident.text);
    if (!binding) return;
    const { line, column } = getLineCol(ident);
    events.push({
      kind: 'write',
      line,
      column,
      varId: binding.id,
      name: binding.name,
      scopeId,
      isPropertyMutation
    });
  }

  function addControlFlow(line: number, tag: string): void {
    const idx = line - 1;
    if (idx >= 0 && idx < totalLines) {
      if (!lineControlFlow[idx].includes(tag)) {
        lineControlFlow[idx].push(tag);
      }
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

  function extractRootIdentifier(expr: ts.Expression): ts.Identifier | null {
    let curr: ts.Expression = expr;
    while (true) {
      if (ts.isParenthesizedExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isAsExpression(curr) || ts.isNonNullExpression(curr) || ts.isSatisfiesExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isPropertyAccessExpression(curr) || ts.isElementAccessExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isIdentifier(curr)) {
        return curr;
      } else {
        return null;
      }
    }
  }

  function visitMemberSubExpressions(
    expr: ts.Expression,
    scopeId: string,
    nesting: number,
    terminalReturn: ts.ReturnStatement | null
  ): void {
    let curr: ts.Expression = expr;
    while (true) {
      if (
        ts.isParenthesizedExpression(curr) ||
        ts.isAsExpression(curr) ||
        ts.isNonNullExpression(curr) ||
        ts.isSatisfiesExpression(curr)
      ) {
        curr = curr.expression;
      } else if (ts.isPropertyAccessExpression(curr)) {
        curr = curr.expression;
      } else if (ts.isElementAccessExpression(curr)) {
        visitNode(curr.argumentExpression, scopeId, nesting, terminalReturn);
        curr = curr.expression;
      } else {
        break;
      }
    }
  }

  function bindPattern(
    pattern: ts.BindingName,
    targetScopeId: string,
    readScopeId: string,
    kind: BindingKind,
    nesting: number,
    terminalReturn: ts.ReturnStatement | null
  ): void {
    if (ts.isIdentifier(pattern)) {
      declareBinding(pattern.text, pattern, targetScopeId, kind);
      return;
    }
    if (ts.isObjectBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        if (el.propertyName && ts.isComputedPropertyName(el.propertyName)) {
          visitNode(el.propertyName.expression, readScopeId, nesting, terminalReturn);
        }
        if (el.initializer) {
          visitNode(el.initializer, readScopeId, nesting, terminalReturn);
        }
        bindPattern(el.name, targetScopeId, readScopeId, kind, nesting, terminalReturn);
      }
      return;
    }
    if (ts.isArrayBindingPattern(pattern)) {
      for (const el of pattern.elements) {
        if (ts.isBindingElement(el)) {
          if (el.initializer) {
            visitNode(el.initializer, readScopeId, nesting, terminalReturn);
          }
          bindPattern(el.name, targetScopeId, readScopeId, kind, nesting, terminalReturn);
        }
      }
    }
  }

  function visitAssignmentTarget(
    expr: ts.Expression,
    scopeId: string,
    nesting: number,
    terminalReturn: ts.ReturnStatement | null
  ): void {
    if (ts.isParenthesizedExpression(expr)) {
      visitAssignmentTarget(expr.expression, scopeId, nesting, terminalReturn);
      return;
    }
    if (ts.isIdentifier(expr)) {
      recordWrite(expr, scopeId, false);
      return;
    }
    if (ts.isPropertyAccessExpression(expr) || ts.isElementAccessExpression(expr)) {
      visitMemberSubExpressions(expr, scopeId, nesting, terminalReturn);
      const root = extractRootIdentifier(expr);
      if (root) {
        recordWrite(root, scopeId, true);
      } else {
        visitNode(expr.expression, scopeId, nesting, terminalReturn);
      }
      return;
    }
    if (ts.isArrayLiteralExpression(expr)) {
      for (const el of expr.elements) {
        if (ts.isSpreadElement(el)) {
          visitAssignmentTarget(el.expression, scopeId, nesting, terminalReturn);
        } else if (ts.isBinaryExpression(el) && el.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          visitNode(el.right, scopeId, nesting, terminalReturn);
          visitAssignmentTarget(el.left, scopeId, nesting, terminalReturn);
        } else if (!ts.isOmittedExpression(el)) {
          visitAssignmentTarget(el, scopeId, nesting, terminalReturn);
        }
      }
      return;
    }
    if (ts.isObjectLiteralExpression(expr)) {
      for (const prop of expr.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) {
          if (prop.objectAssignmentInitializer) {
            visitNode(prop.objectAssignmentInitializer, scopeId, nesting, terminalReturn);
          }
          recordWrite(prop.name, scopeId, false);
        } else if (ts.isPropertyAssignment(prop)) {
          if (ts.isComputedPropertyName(prop.name)) {
            visitNode(prop.name.expression, scopeId, nesting, terminalReturn);
          }
          if (
            ts.isBinaryExpression(prop.initializer) &&
            prop.initializer.operatorToken.kind === ts.SyntaxKind.EqualsToken
          ) {
            visitNode(prop.initializer.right, scopeId, nesting, terminalReturn);
            visitAssignmentTarget(prop.initializer.left, scopeId, nesting, terminalReturn);
          } else {
            visitAssignmentTarget(prop.initializer, scopeId, nesting, terminalReturn);
          }
        } else if (ts.isSpreadAssignment(prop)) {
          visitAssignmentTarget(prop.expression, scopeId, nesting, terminalReturn);
        }
      }
    }
  }

  function predeclareHoistedFunctions(
    statements: ts.NodeArray<ts.Statement>,
    scopeId: string
  ): void {
    for (const stmt of statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        declareBinding(stmt.name.text, stmt.name, scopeId, 'function');
      } else if (ts.isClassDeclaration(stmt) && stmt.name) {
        declareBinding(stmt.name.text, stmt.name, scopeId, 'class');
      }
    }
  }

  function getTerminalReturn(body: ts.ConciseBody): ts.ReturnStatement | null {
    if (!ts.isBlock(body) || body.statements.length === 0) return null;
    const last = body.statements[body.statements.length - 1];
    return ts.isReturnStatement(last) ? last : null;
  }

  function visitFunctionLike(
    node: ts.FunctionLikeDeclaration,
    parentScopeId: string,
    nesting: number,
    isNestedCallable: boolean
  ): void {
    const startLine = getLineCol(node).line;
    const endLine = getEndLine(node);
    const fnScope = createScope(parentScopeId, 'function', startLine, endLine, true);
    const innerNesting = isNestedCallable ? nesting + 1 : nesting;

    if (isNestedCallable && endLine > startLine) {
      markNesting(startLine + 1, endLine - 1, innerNesting);
    }

    // Named function expression binds its own name inside fnScope
    if (ts.isFunctionExpression(node) && node.name) {
      declareBinding(node.name.text, node.name, fnScope.id, 'function');
    }

    for (const param of node.parameters) {
      if (param.initializer) {
        visitNode(param.initializer, fnScope.id, innerNesting, null);
      }
      bindPattern(param.name, fnScope.id, fnScope.id, 'param', innerNesting, null);
    }

    if (node.body) {
      const termRet = getTerminalReturn(node.body);
      if (ts.isBlock(node.body)) {
        predeclareHoistedFunctions(node.body.statements, fnScope.id);
        for (const stmt of node.body.statements) {
          visitNode(stmt, fnScope.id, innerNesting, termRet);
        }
      } else {
        visitNode(node.body, fnScope.id, innerNesting, null);
      }
    }
  }

  function visitBlockBody(
    node: ts.Statement,
    parentScopeId: string,
    nesting: number,
    terminalReturn: ts.ReturnStatement | null,
    scopeKind: ScopeInfo['kind'] = 'block'
  ): void {
    const startLine = getLineCol(node).line;
    const endLine = getEndLine(node);
    if (ts.isBlock(node)) {
      if (endLine > startLine) {
        markNesting(startLine + 1, endLine - 1, nesting);
      } else {
        markNesting(startLine, endLine, nesting);
      }
      const blockScope = createScope(parentScopeId, scopeKind, startLine, endLine, false);
      predeclareHoistedFunctions(node.statements, blockScope.id);
      for (const stmt of node.statements) {
        visitNode(stmt, blockScope.id, nesting, terminalReturn);
      }
    } else {
      markNesting(startLine, endLine, nesting);
      visitNode(node, parentScopeId, nesting, terminalReturn);
    }
  }

  function visitVariableDeclarationList(
    declList: ts.VariableDeclarationList,
    scopeId: string,
    nesting: number,
    terminalReturn: ts.ReturnStatement | null,
    overrideKind?: BindingKind
  ): void {
    const flags = declList.flags;
    const kind: BindingKind =
      overrideKind ??
      (flags & ts.NodeFlags.Const
        ? 'const'
        : flags & ts.NodeFlags.Let
          ? 'let'
          : 'var');

    for (const decl of declList.declarations) {
      if (decl.initializer) {
        visitNode(decl.initializer, scopeId, nesting, terminalReturn);
      }
      // If `var` re-declares with initializer in same scope, record write
      if (
        kind === 'var' &&
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        scopeBindings.get(scopes.get(scopeId)!.functionBoundaryId)?.has(decl.name.text)
      ) {
        recordWrite(decl.name, scopeId, false);
      } else {
        bindPattern(decl.name, scopeId, scopeId, kind, nesting, terminalReturn);
      }
    }
  }

  function visitNode(
    node: ts.Node,
    scopeId: string,
    nesting: number,
    terminalReturn: ts.ReturnStatement | null
  ): void {
    // Skip TypeScript type-only declarations
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isTypeNode(node)
    ) {
      return;
    }

    // Import declarations
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) return;
      if (clause.name) {
        declareBinding(clause.name.text, clause.name, scopeId, 'import');
      }
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          declareBinding(clause.namedBindings.name.text, clause.namedBindings.name, scopeId, 'import');
        } else if (ts.isNamedImports(clause.namedBindings)) {
          for (const spec of clause.namedBindings.elements) {
            if (!spec.isTypeOnly) {
              declareBinding(spec.name.text, spec.name, scopeId, 'import');
            }
          }
        }
      }
      return;
    }

    // Enum declaration
    if (ts.isEnumDeclaration(node)) {
      declareBinding(node.name.text, node.name, scopeId, 'const');
      for (const member of node.members) {
        if (member.initializer) {
          visitNode(member.initializer, scopeId, nesting, terminalReturn);
        }
      }
      return;
    }

    // Function declaration
    if (ts.isFunctionDeclaration(node)) {
      if (node.name) {
        declareBinding(node.name.text, node.name, scopeId, 'function');
      }
      if (!node.body) return;
      const parentScope = scopes.get(scopeId)!;
      const isNested = parentScope.depth > 0;
      visitFunctionLike(node, scopeId, nesting, isNested);
      return;
    }

    // Arrow function / Function expression
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parentScope = scopes.get(scopeId)!;
      const isNested = parentScope.depth > 0 || nesting > 0;
      visitFunctionLike(node, scopeId, nesting, isNested);
      return;
    }

    // Class declaration / expression
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      if (ts.isClassDeclaration(node) && node.name) {
        declareBinding(node.name.text, node.name, scopeId, 'class');
      }
      if (node.heritageClauses) {
        for (const h of node.heritageClauses) {
          for (const t of h.types) {
            visitNode(t.expression, scopeId, nesting, terminalReturn);
          }
        }
      }
      const clsScope = createScope(
        scopeId,
        'class',
        getLineCol(node).line,
        getEndLine(node),
        false
      );
      if (ts.isClassExpression(node) && node.name) {
        declareBinding(node.name.text, node.name, clsScope.id, 'class');
      }
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) ||
          ts.isConstructorDeclaration(member) ||
          ts.isGetAccessorDeclaration(member) ||
          ts.isSetAccessorDeclaration(member)
        ) {
          visitFunctionLike(member, clsScope.id, nesting, false);
        } else if (ts.isPropertyDeclaration(member) && member.initializer) {
          visitNode(member.initializer, clsScope.id, nesting, null);
        }
      }
      return;
    }

    // Variable statement
    if (ts.isVariableStatement(node)) {
      visitVariableDeclarationList(node.declarationList, scopeId, nesting, terminalReturn);
      return;
    }

    // Block statement (standalone)
    if (ts.isBlock(node)) {
      const blockScope = createScope(
        scopeId,
        'block',
        getLineCol(node).line,
        getEndLine(node),
        false
      );
      predeclareHoistedFunctions(node.statements, blockScope.id);
      for (const stmt of node.statements) {
        visitNode(stmt, blockScope.id, nesting, terminalReturn);
      }
      return;
    }

    // If statement (else-if stays at same nesting depth)
    if (ts.isIfStatement(node)) {
      visitNode(node.expression, scopeId, nesting, terminalReturn);
      visitBlockBody(node.thenStatement, scopeId, nesting + 1, null);
      if (node.elseStatement) {
        if (ts.isIfStatement(node.elseStatement)) {
          visitNode(node.elseStatement, scopeId, nesting, null);
        } else {
          visitBlockBody(node.elseStatement, scopeId, nesting + 1, null);
        }
      }
      return;
    }

    // For loop
    if (ts.isForStatement(node)) {
      const loopScope = createScope(
        scopeId,
        'loop',
        getLineCol(node).line,
        getEndLine(node),
        false
      );
      if (node.initializer) {
        if (ts.isVariableDeclarationList(node.initializer)) {
          visitVariableDeclarationList(node.initializer, loopScope.id, nesting, null, 'loop');
        } else {
          visitNode(node.initializer, loopScope.id, nesting, null);
        }
      }
      if (node.condition) visitNode(node.condition, loopScope.id, nesting, null);
      if (node.incrementor) visitNode(node.incrementor, loopScope.id, nesting, null);
      visitBlockBody(node.statement, loopScope.id, nesting + 1, null, 'block');
      return;
    }

    // For-of / For-in
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const loopScope = createScope(
        scopeId,
        'loop',
        getLineCol(node).line,
        getEndLine(node),
        false
      );
      visitNode(node.expression, scopeId, nesting, null);
      if (ts.isVariableDeclarationList(node.initializer)) {
        visitVariableDeclarationList(node.initializer, loopScope.id, nesting, null, 'loop');
      } else {
        visitAssignmentTarget(node.initializer, loopScope.id, nesting, null);
      }
      visitBlockBody(node.statement, loopScope.id, nesting + 1, null, 'block');
      return;
    }

    // While / Do-While
    if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      visitNode(node.expression, scopeId, nesting, null);
      visitBlockBody(node.statement, scopeId, nesting + 1, null, 'loop');
      return;
    }

    // Switch
    if (ts.isSwitchStatement(node)) {
      visitNode(node.expression, scopeId, nesting, null);
      const swScope = createScope(
        scopeId,
        'block',
        getLineCol(node).line,
        getEndLine(node),
        false
      );
      const startL = getLineCol(node.caseBlock).line;
      const endL = getEndLine(node.caseBlock);
      if (endL > startL) markNesting(startL + 1, endL - 1, nesting + 1);
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          visitNode(clause.expression, swScope.id, nesting + 1, null);
        }
        for (const stmt of clause.statements) {
          visitNode(stmt, swScope.id, nesting + 1, null);
        }
      }
      return;
    }

    // Try / Catch / Finally
    if (ts.isTryStatement(node)) {
      visitBlockBody(node.tryBlock, scopeId, nesting + 1, null);
      if (node.catchClause) {
        const cStart = getLineCol(node.catchClause).line;
        const cEnd = getEndLine(node.catchClause);
        addControlFlow(cStart, 'catch');
        const catchScope = createScope(scopeId, 'catch', cStart, cEnd, false);
        if (node.catchClause.variableDeclaration) {
          bindPattern(
            node.catchClause.variableDeclaration.name,
            catchScope.id,
            catchScope.id,
            'catch',
            nesting + 1,
            null
          );
        }
        if (cEnd > cStart) markNesting(cStart + 1, cEnd - 1, nesting + 1);
        for (const stmt of node.catchClause.block.statements) {
          visitNode(stmt, catchScope.id, nesting + 1, null);
        }
      }
      if (node.finallyBlock) {
        visitBlockBody(node.finallyBlock, scopeId, nesting + 1, null);
      }
      return;
    }

    // Control-flow statements
    if (ts.isBreakStatement(node)) {
      addControlFlow(getLineCol(node).line, 'break');
      return;
    }
    if (ts.isContinueStatement(node)) {
      addControlFlow(getLineCol(node).line, 'continue');
      return;
    }
    if (ts.isThrowStatement(node)) {
      addControlFlow(getLineCol(node).line, 'throw');
      if (node.expression) visitNode(node.expression, scopeId, nesting, null);
      return;
    }
    if (ts.isReturnStatement(node)) {
      if (node !== terminalReturn) {
        addControlFlow(getLineCol(node).line, 'early-return');
      }
      if (node.expression) visitNode(node.expression, scopeId, nesting, null);
      return;
    }

    // Assignments & binary expressions
    if (ts.isBinaryExpression(node)) {
      const opKind = node.operatorToken.kind;
      if (opKind === ts.SyntaxKind.EqualsToken) {
        visitNode(node.right, scopeId, nesting, terminalReturn);
        visitAssignmentTarget(node.left, scopeId, nesting, terminalReturn);
        return;
      }
      if (COMPOUND_ASSIGNMENT_KINDS.has(opKind)) {
        visitNode(node.right, scopeId, nesting, terminalReturn);
        if (ts.isIdentifier(node.left)) {
          recordRead(node.left, scopeId);
          recordWrite(node.left, scopeId, false);
        } else {
          visitMemberSubExpressions(node.left, scopeId, nesting, terminalReturn);
          const root = extractRootIdentifier(node.left);
          if (root) {
            recordRead(root, scopeId);
            recordWrite(root, scopeId, true);
          } else {
            visitNode(node.left, scopeId, nesting, terminalReturn);
          }
        }
        return;
      }
      visitNode(node.left, scopeId, nesting, terminalReturn);
      visitNode(node.right, scopeId, nesting, terminalReturn);
      return;
    }

    // ++ / --
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      if (ts.isIdentifier(node.operand)) {
        recordRead(node.operand, scopeId);
        recordWrite(node.operand, scopeId, false);
      } else {
        visitMemberSubExpressions(node.operand, scopeId, nesting, terminalReturn);
        const root = extractRootIdentifier(node.operand);
        if (root) {
          recordRead(root, scopeId);
          recordWrite(root, scopeId, true);
        } else {
          visitNode(node.operand, scopeId, nesting, terminalReturn);
        }
      }
      return;
    }

    // delete obj.prop
    if (ts.isDeleteExpression(node)) {
      visitMemberSubExpressions(node.expression, scopeId, nesting, terminalReturn);
      const root = extractRootIdentifier(node.expression);
      if (root) {
        recordWrite(root, scopeId, true);
      } else {
        visitNode(node.expression, scopeId, nesting, terminalReturn);
      }
      return;
    }

    // Mutating method calls like arr.push(x), map.set(k, v)
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        MUTATING_METHODS.has(node.expression.name.text)
      ) {
        visitMemberSubExpressions(node.expression.expression, scopeId, nesting, terminalReturn);
        const root = extractRootIdentifier(node.expression.expression);
        if (root) {
          recordWrite(root, scopeId, true);
        } else {
          visitNode(node.expression.expression, scopeId, nesting, terminalReturn);
        }
      } else {
        visitNode(node.expression, scopeId, nesting, terminalReturn);
      }
      for (const arg of node.arguments) {
        visitNode(arg, scopeId, nesting, terminalReturn);
      }
      return;
    }

    // Property access: visit object expression, NOT the property name
    if (ts.isPropertyAccessExpression(node)) {
      visitNode(node.expression, scopeId, nesting, terminalReturn);
      return;
    }

    // Object literal property assignments
    if (ts.isPropertyAssignment(node)) {
      if (ts.isComputedPropertyName(node.name)) {
        visitNode(node.name.expression, scopeId, nesting, terminalReturn);
      }
      visitNode(node.initializer, scopeId, nesting, terminalReturn);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      recordRead(node.name, scopeId);
      if (node.objectAssignmentInitializer) {
        visitNode(node.objectAssignmentInitializer, scopeId, nesting, terminalReturn);
      }
      return;
    }
    if (ts.isMethodDeclaration(node)) {
      if (ts.isComputedPropertyName(node.name)) {
        visitNode(node.name.expression, scopeId, nesting, terminalReturn);
      }
      visitFunctionLike(node, scopeId, nesting, true);
      return;
    }

    // Export specifier: `export { foo as bar }` reads `foo`
    if (ts.isExportSpecifier(node)) {
      const localIdent = node.propertyName ?? node.name;
      if (ts.isIdentifier(localIdent)) {
        recordRead(localIdent, scopeId);
      }
      return;
    }

    // Labeled statement: skip label identifier
    if (ts.isLabeledStatement(node)) {
      visitNode(node.statement, scopeId, nesting, terminalReturn);
      return;
    }

    // Conditional (ternary) increases nesting slightly if chained
    if (ts.isConditionalExpression(node)) {
      visitNode(node.condition, scopeId, nesting, terminalReturn);
      const isNestedTernary =
        ts.isConditionalExpression(node.whenTrue) || ts.isConditionalExpression(node.whenFalse);
      if (isNestedTernary) {
        markNesting(getLineCol(node).line, getEndLine(node), nesting + 1);
      }
      visitNode(node.whenTrue, scopeId, isNestedTernary ? nesting + 1 : nesting, terminalReturn);
      visitNode(node.whenFalse, scopeId, isNestedTernary ? nesting + 1 : nesting, terminalReturn);
      return;
    }

    // JSX tags: don't treat intrinsic lowercase tag names as variable reads, but DO read uppercase components
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName) && /^[A-Z]/.test(node.tagName.text)) {
        recordRead(node.tagName, scopeId);
      } else if (ts.isPropertyAccessExpression(node.tagName)) {
        visitNode(node.tagName, scopeId, nesting, terminalReturn);
      }
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.initializer) {
          visitNode(attr.initializer, scopeId, nesting, terminalReturn);
        } else if (ts.isJsxSpreadAttribute(attr)) {
          visitNode(attr.expression, scopeId, nesting, terminalReturn);
        }
      }
      return;
    }
    if (ts.isJsxClosingElement(node)) {
      return;
    }

    // Plain value identifier read
    if (ts.isIdentifier(node)) {
      recordRead(node, scopeId);
      return;
    }

    // Default traversal
    ts.forEachChild(node, (child) => {
      visitNode(child, scopeId, nesting, terminalReturn);
    });
  }

  const rootScope = createScope(null, 'module', 1, Math.max(1, totalLines), true);
  predeclareHoistedFunctions(sourceFile.statements, rootScope.id);
  for (const stmt of sourceFile.statements) {
    visitNode(stmt, rootScope.id, 0, null);
  }

  return {
    language,
    sourceLines,
    scopes,
    bindings,
    events,
    lineNesting,
    lineControlFlow
  };
}
