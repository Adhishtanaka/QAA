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
  // Desktop-only telemetry (absent for mobile steps)
  apiCalls?: ApiCall[];
  consoleLogs?: ConsoleEntry[];
  storage?: StorageSnapshot;
  usedAI?: boolean; // true when AI fallback was used (mobile runs)
}

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
}

export interface MobileRun {
  viewport: ViewportConfig;
  steps: StepReport[];
}

export interface TestReport {
  testName: string;
  timestamp: string;
  desktopSteps: StepReport[];
  mobileRuns: MobileRun[];
  generatedCode: string;
}
