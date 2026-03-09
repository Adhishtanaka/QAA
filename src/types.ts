export interface ApiCall {
  url: string;
  method: string;
  requestPayload?: string;
  responseStatus?: number;
  responseBody?: string;
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

export interface StorageSnapshot {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  cookies: Array<{ name: string; value: string; domain?: string }>;
}

export interface PageMetrics {
  stepDurationMs: number;
  loadTimeMs?: number;
  domContentLoadedMs?: number;
  heapUsedMB?: number;
}

export interface StepReport {
  description: string;
  status: 'pass' | 'fail' | 'pending';
  screenshot: string; // base64 PNG
  error?: string;
  metrics?: PageMetrics;
  apiCalls?: ApiCall[];
  consoleLogs?: ConsoleEntry[];
  storage?: StorageSnapshot;
}

export interface TestCaseReport {
  testName: string;
  desktopSteps: StepReport[];
  generatedCode?: string;
  generatedPlaywrightCode?: string;
}

export interface TestReport {
  suiteName: string;
  timestamp: string;
  testCases: TestCaseReport[];
}
