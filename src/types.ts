export type FrontlabFiles = Readonly<{ html: string; css: string; javascript: string }>;
export type Diagnostic = Readonly<{ level: 'error' | 'warn' | 'log' | 'info'; message: string; runId: number; kind: 'console' | 'runtime' | 'promise' | 'protocol' }>;
export type EngineState = 'idle' | 'starting' | 'running' | 'stopped' | 'disposed';
export type EngineEvent =
  | { type: 'state'; state: EngineState; runId: number }
  | { type: 'diagnostic'; diagnostic: Diagnostic }
  | { type: 'css-updated'; runId: number }
  | { type: 'timeout'; runId: number; timeoutMs: number };
export type EngineListener = (event: EngineEvent) => void;
export type EngineOptions = Readonly<{ debounceMs?: number; onEvent?: EngineListener; runnerUrl?: string; startupTimeoutMs?: number }>;
