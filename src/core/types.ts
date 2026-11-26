export type Language = 'typescript' | 'javascript' | 'python';

export type VarEventKind = 'def' | 'read' | 'write';

export type BindingKind =
  | 'param'
  | 'var'
  | 'const'
  | 'let'
  | 'function'
  | 'catch'
  | 'loop'
  | 'comprehension'
  | 'import'
  | 'class';

export interface VarEvent {
  kind: VarEventKind;
  line: number;
  column: number;
  varId: string;
  name: string;
  scopeId: string;
  isPropertyMutation?: boolean;
}

export interface VariableLifecycle {
  id: string;
  name: string;
  scopeId: string;
  scopeDepth: number;
  defLine: number;
  lastUseLine: number;
  mutations: number[];
  reads: number[];
  isShadowed: boolean;
  isCaptured: boolean;
  maxJumpDistance: number;
  kind: BindingKind;
}

export type EyeJumpKind = 'def-to-read' | 'def-to-write' | 'write-to-read';

export interface EyeJumpArc {
  varId: string;
  varName: string;
  fromLine: number;
  toLine: number;
  kind: EyeJumpKind;
  distance: number;
}

export type Severity = 'calm' | 'moderate' | 'high' | 'overload';

export interface LineMetrics {
  line: number;
  text: string;
  liveVars: string[];
  liveVarNames: string[];
  slotCount: number;
  overflow: number;
  nestingDepth: number;
  jumpSum: number;
  maxJumpHere: number;
  mutationCount: number;
  controlFlowJump: boolean;
  controlFlowKinds: string[];
  shadowingEvents: number;
  captureEvents: number;
  score: number;
  severity: Severity;
}

export type HintCategory =
  | 'memory-overflow'
  | 'long-lifetime'
  | 'shadowing'
  | 'high-mutation'
  | 'closure-capture'
  | 'deep-nesting'
  | 'control-flow';

export type HintSeverity = 'critical' | 'warning' | 'info';

export interface RefactoringHint {
  id: string;
  category: HintCategory;
  severity: HintSeverity;
  title: string;
  detail: string;
  suggestion: string;
  startLine: number;
  endLine: number;
  variableName?: string;
  impactScore: number;
}

export type CognitiveGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface AnalysisSummary {
  totalLines: number;
  codeLines: number;
  totalVariables: number;
  peakSlots: number;
  peakSlotsLine: number;
  avgSlots: number;
  avgScore: number;
  maxScore: number;
  maxScoreLine: number;
  overloadLines: number;
  highLines: number;
  maxJumpDistance: number;
  totalMutations: number;
  shadowedCount: number;
  capturedCount: number;
  maxNestingDepth: number;
  controlFlowJumps: number;
  grade: CognitiveGrade;
}

export interface AnalysisOptions {
  capacity?: number;
  fileName?: string;
  language?: Language;
}

export interface AnalysisResult {
  fileName: string;
  language: Language;
  capacity: number;
  source: string;
  lines: LineMetrics[];
  variables: VariableLifecycle[];
  events: VarEvent[];
  arcs: EyeJumpArc[];
  hints: RefactoringHint[];
  summary: AnalysisSummary;
}

export interface DiffComparison {
  before: AnalysisResult;
  after: AnalysisResult;
  peakSlotsDelta: number;
  avgScoreDelta: number;
  maxScoreDelta: number;
  overloadLinesDelta: number;
  maxJumpDelta: number;
  mutationsDelta: number;
  hintsDelta: number;
  improvementPct: number;
  verdict: 'improved' | 'unchanged' | 'regressed';
}

export interface ScopeInfo {
  id: string;
  parentId: string | null;
  kind: 'module' | 'function' | 'block' | 'class' | 'loop' | 'catch' | 'comprehension';
  depth: number;
  functionBoundaryId: string;
  startLine: number;
  endLine: number;
}

export interface ParsedBinding {
  id: string;
  name: string;
  scopeId: string;
  scopeDepth: number;
  functionBoundaryId: string;
  defLine: number;
  defColumn: number;
  kind: BindingKind;
  isShadowed: boolean;
}

export interface ParsedProgram {
  language: Language;
  sourceLines: string[];
  scopes: Map<string, ScopeInfo>;
  bindings: Map<string, ParsedBinding>;
  events: VarEvent[];
  lineNesting: number[];
  lineControlFlow: string[][];
}
