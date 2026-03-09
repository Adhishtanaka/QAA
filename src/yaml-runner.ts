import yaml from 'js-yaml';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { createHash } from 'crypto';

import { callAI } from './ai';
import { tools } from './Tools';
import {
  executeTool, initBrowser, closeBrowser, getCurrentPage, takeScreenshot,
  clearStepTelemetry, getStepTelemetry,
  captureStorageSnapshot, capturePageMetrics,
} from './browser';
import { generatePuppeteerCode, generatePlaywrightCode, type RecordedAction, type ActionCache } from './code-generator';
import { getSystemPrompt } from './prompt';
import { generateHTMLReport } from './report';
import { initVerbose, logAIExchange } from './verbose';
import type { StepReport, TestReport, TestCaseReport } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  steps: string[];
}

type Status = 'pending' | 'running' | 'pass' | 'fail';

// ─── YAML parsing ─────────────────────────────────────────────────────────────

function parseTestCase(t: any): TestCase {
  if (!t?.name || !Array.isArray(t?.steps))
    throw new Error('Each test must have "name" (string) and "steps" (array) fields');
  return {
    name: t.name,
    steps: t.steps.map(String),
  };
}

function parseYaml(filePath: string): TestCase[] {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content) as any;

  // Multi-test format: { tests: [...] }
  if (Array.isArray(parsed?.tests)) {
    return parsed.tests.map(parseTestCase);
  }

  // Single test format (backward compatible)
  if (!parsed?.name || !Array.isArray(parsed?.steps))
    throw new Error('YAML must have "name" and "steps" fields, or a "tests" array of test cases');
  return [parseTestCase(parsed)];
}

// ─── Paths & hashing ──────────────────────────────────────────────────────────

export function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function computeHash(steps: string[]): string {
  return createHash('sha256').update(steps.join('\n')).digest('hex').slice(0, 12);
}

const GENERATED_DIR = 'generated';
const REPORTS_DIR = 'reports';

function cacheJsonPath(name: string) { return join(GENERATED_DIR, `${slugify(name)}.json`); }
function reportPath(name: string, timestamp: string) { return join(REPORTS_DIR, `${slugify(name)}-${timestamp}.html`); }

// ─── Checklist rendering ──────────────────────────────────────────────────────

const GREEN  = '\x1B[32m';
const RED    = '\x1B[31m';
const YELLOW = '\x1B[33m';
const DIM    = '\x1B[2m';
const RESET  = '\x1B[0m';
const BOLD   = '\x1B[1m';

function icon(s: Status): string {
  if (s === 'pass')    return `${GREEN}[✓]${RESET}`;
  if (s === 'fail')    return `${RED}[✗]${RESET}`;
  if (s === 'running') return `${YELLOW}[~]${RESET}`;
  return `${DIM}[ ]${RESET}`;
}

let lastRenderLines = 0;

function renderChecklist(name: string, steps: string[], statuses: Status[], info = '') {
  if (lastRenderLines > 0) process.stdout.write(`\x1B[${lastRenderLines}A\x1B[0J`);
  const lines: string[] = [];
  lines.push(`${BOLD}  QAA — ${name}${RESET}`);
  lines.push(`  ${'─'.repeat(58)}`);
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const status = statuses[i]!;
    const truncated = step.length > 55 ? step.slice(0, 52) + '...' : step;
    lines.push(`  ${icon(status)} ${i + 1}. ${truncated}`);
  }
  lines.push(`  ${'─'.repeat(58)}`);
  if (info) lines.push(`  ${DIM}${info}${RESET}`);
  process.stdout.write(lines.join('\n') + '\n');
  lastRenderLines = lines.length;
}

// ─── Step timeout helper ──────────────────────────────────────────────────────

const STEP_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Step timed out after ${ms / 1000}s: ${label}`)), ms)
    ),
  ]);
}

// ─── Debug helper ─────────────────────────────────────────────────────────────

function buildDebugLines(url: string, actions: RecordedAction[], aiResponse?: string): string {
  const toolTrace = actions
    .map(a => `    ${DIM}→ ${a.tool}(${JSON.stringify(a.args).slice(0, 80)})${RESET}`)
    .join('\n');
  return (
    `  ${DIM}URL: ${url}${RESET}\n` +
    (toolTrace ? `  ${DIM}Tools called:${RESET}\n${toolTrace}\n` : '') +
    (aiResponse ? `  ${DIM}AI: ${aiResponse.slice(0, 300)}${aiResponse.length > 300 ? '…' : ''}${RESET}\n` : '')
  );
}

// ─── AI step executor ─────────────────────────────────────────────────────────

async function runStepWithAI(
  step: string,
  currentUrl: string,
): Promise<{ success: boolean; error?: string; actions: RecordedAction[]; debugLines?: string }> {
  const systemPrompt = getSystemPrompt(currentUrl);

  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Execute this test step: ${step}` },
  ];

  const actions: RecordedAction[] = [];
  const MAX_ITER = 10;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await callAI(messages, tools);
    const message = response.choices[0]?.message;
    if (!message) throw new Error('No response from AI');

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const content = typeof message.content === 'string' ? message.content : '';
      logAIExchange(step, messages, content);
      const failMatch = content.match(/FAIL:\s*(.+?)(?:\n|$)/i);
      if (failMatch) {
        return { success: false, error: failMatch[1].trim(), actions, debugLines: buildDebugLines(getCurrentPage()?.url() ?? currentUrl, actions, content) };
      }
      return { success: true, actions };
    }

    for (const toolCall of message.tool_calls) {
      const toolName: string = toolCall.function.name;
      let toolArgs: any;
      try { toolArgs = JSON.parse(toolCall.function.arguments); }
      catch { toolArgs = {}; }

      actions.push({ tool: toolName, args: toolArgs, step });

      let result: string;
      try { result = await executeTool(toolName, toolArgs); }
      catch (err: any) { result = `ERROR: ${err.message}`; }

      messages.push({ role: 'tool', tool_call_id: toolCall.id, name: toolName, content: result });
    }
  }

  return { success: false, error: 'Max iterations reached', actions, debugLines: buildDebugLines(getCurrentPage()?.url() ?? currentUrl, actions) };
}

// ─── Cached replay executor ───────────────────────────────────────────────────

async function runStepFromCache(
  stepActions: RecordedAction[]
): Promise<{ success: boolean; error?: string }> {
  for (const action of stepActions) {
    try {
      const result = await executeTool(action.tool, action.args);
      if (result.startsWith('ERROR:')) return { success: false, error: result };
    } catch (err: any) {
      return { success: false, error: `${action.tool} failed: ${err.message}` };
    }
  }
  return { success: true };
}

// ─── Empty step report helper ─────────────────────────────────────────────────

function emptyStep(description: string): StepReport {
  return { description, status: 'pending', screenshot: '' };
}

// ─── Single test case runner ──────────────────────────────────────────────────

async function runTestCase(testCase: TestCase): Promise<{ caseReport: TestCaseReport; failed: boolean }> {
  const hash = computeHash(testCase.steps);
  const jsonPath = cacheJsonPath(testCase.name);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  initVerbose(slugify(testCase.name), timestamp);

  let cachedActions: RecordedAction[] | null = null;
  if (existsSync(jsonPath)) {
    const cached: ActionCache = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    if (cached.hash === hash) cachedActions = cached.actions;
  }

  const usingCache = cachedActions !== null;
  const statuses: Status[] = testCase.steps.map(() => 'pending');
  const desktopSteps: StepReport[] = testCase.steps.map(desc => emptyStep(desc));

  lastRenderLines = 0;
  renderChecklist(
    testCase.name, testCase.steps, statuses,
    usingCache ? 'Using cached actions (no AI needed)' : 'Running with AI...'
  );

  const allActions: RecordedAction[] = [];
  let passed = 0;
  let failed = 0;

  type FailInfo = { num: number; error?: string; debugLines?: string };
  const desktopFailures: FailInfo[] = [];

  if (usingCache) {
    const actionsByStep = new Map<string, RecordedAction[]>();
    for (const action of cachedActions!) {
      const list = actionsByStep.get(action.step) ?? [];
      list.push(action);
      actionsByStep.set(action.step, list);
    }

    let desktopAborted = false;

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i]!;

      if (desktopAborted) {
        statuses[i] = 'fail'; failed++;
        desktopSteps[i] = { description: step, status: 'fail', screenshot: '', error: 'Skipped — previous step failed' };
        continue;
      }

      statuses[i] = 'running';
      renderChecklist(testCase.name, testCase.steps, statuses, `Running step ${i + 1}/${testCase.steps.length}...`);

      const stepStartMs = Date.now();
      clearStepTelemetry();
      const result = await withTimeout(
        runStepFromCache(actionsByStep.get(step) ?? []),
        STEP_TIMEOUT_MS, step
      ).catch(err => ({ success: false, error: err.message }));

      const screenshot = await takeScreenshot();
      const { apiCalls, consoleLogs } = getStepTelemetry();
      const storage = await captureStorageSnapshot();
      const metrics = await capturePageMetrics(stepStartMs);

      if (result.success) {
        statuses[i] = 'pass'; passed++;
        desktopSteps[i] = { description: step, status: 'pass', screenshot, apiCalls, consoleLogs, storage, metrics };
      } else {
        statuses[i] = 'fail'; failed++;
        desktopSteps[i] = { description: step, status: 'fail', screenshot, error: result.error, apiCalls, consoleLogs, storage, metrics };
        desktopAborted = true;
        desktopFailures.push({ num: i + 1, error: result.error });
      }
    }
  } else {
    let desktopAborted = false;

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i]!;

      if (desktopAborted) {
        statuses[i] = 'fail'; failed++;
        desktopSteps[i] = { description: step, status: 'fail', screenshot: '', error: 'Skipped — previous step failed' };
        continue;
      }

      statuses[i] = 'running';
      renderChecklist(testCase.name, testCase.steps, statuses, `AI executing step ${i + 1}/${testCase.steps.length}...`);

      const currentUrl = getCurrentPage()?.url() ?? 'about:blank';

      const stepStartMs = Date.now();
      clearStepTelemetry();
      const result = await withTimeout(
        runStepWithAI(step, currentUrl),
        STEP_TIMEOUT_MS, step
      ).catch(err => ({ success: false, error: err.message, actions: [] as RecordedAction[], debugLines: undefined }));

      allActions.push(...result.actions);
      const screenshot = await takeScreenshot();
      const { apiCalls, consoleLogs } = getStepTelemetry();
      const storage = await captureStorageSnapshot();
      const metrics = await capturePageMetrics(stepStartMs);

      if (result.success) {
        statuses[i] = 'pass'; passed++;
        desktopSteps[i] = { description: step, status: 'pass', screenshot, apiCalls, consoleLogs, storage, metrics };
      } else {
        statuses[i] = 'fail'; failed++;
        desktopSteps[i] = { description: step, status: 'fail', screenshot, error: result.error, apiCalls, consoleLogs, storage, metrics };
        desktopAborted = true;
        desktopFailures.push({ num: i + 1, error: result.error, debugLines: result.debugLines });
      }
    }

    if (failed === 0) {
      const cache: ActionCache = { hash, testName: testCase.name, actions: allActions };
      writeFileSync(jsonPath, JSON.stringify(cache, null, 2));
    }
  }

  // Generate code from recorded or cached actions
  const effectiveActions = allActions.length > 0 ? allActions : (cachedActions ?? []);
  const generatedCode = effectiveActions.length > 0
    ? generatePuppeteerCode(testCase.name, hash, effectiveActions)
    : undefined;
  const generatedPlaywrightCode = effectiveActions.length > 0
    ? generatePlaywrightCode(testCase.name, hash, effectiveActions)
    : undefined;

  const desktopSummary = failed === 0
    ? `${GREEN}All ${passed} steps passed!${RESET}`
    : `${passed} passed, ${RED}${failed} failed${RESET}`;
  renderChecklist(testCase.name, testCase.steps, statuses, desktopSummary);
  for (const f of desktopFailures) {
    process.stdout.write(`  ${RED}✗ Step ${f.num} failed:${RESET} ${f.error ?? 'unknown error'}\n`);
    if (f.debugLines) process.stdout.write(f.debugLines);
  }
  if (desktopFailures.length > 0) lastRenderLines = 0;

  await new Promise(resolve => setTimeout(resolve, 5000));

  if (!usingCache && failed === 0)
    console.log(`  ${DIM}Next run replays actions directly — no AI needed.${RESET}`);
  if (usingCache && failed > 0)
    console.log(`\n  ${YELLOW}Cached actions failed. Run: bun src/index.ts clear <yaml>${RESET}`);

  return {
    caseReport: { testName: testCase.name, desktopSteps, generatedCode, generatedPlaywrightCode },
    failed: failed > 0,
  };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function runTest(yamlPath: string): Promise<void> {
  const testCases = parseYaml(yamlPath);
  const suiteName = testCases.length === 1 ? testCases[0]!.name : yamlPath.replace(/^.*[\\/]/, '').replace(/\.ya?ml$/, '');

  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  await initBrowser();

  const caseReports: TestCaseReport[] = [];
  let anyFailed = false;
  for (const testCase of testCases) {
    const { caseReport, failed } = await runTestCase(testCase);
    caseReports.push(caseReport);
    if (failed) anyFailed = true;
  }

  await closeBrowser();

  const report: TestReport = { suiteName, timestamp, testCases: caseReports };
  const html = generateHTMLReport(report);
  const rptPath = reportPath(suiteName, timestamp);
  writeFileSync(rptPath, html);

  console.log(`  Report:  ${rptPath}`);

  const absPath = resolve(rptPath);
  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', absPath]);
  } else if (process.platform === 'darwin') {
    execFile('open', [absPath]);
  } else {
    execFile('xdg-open', [absPath]);
  }

  console.log('');

  if (anyFailed) process.exit(1);
}

// ─── Cache clear ──────────────────────────────────────────────────────────────

export function clearCache(yamlPath: string): void {
  const testCases = parseYaml(yamlPath);
  for (const testCase of testCases) {
    const jsonPath = cacheJsonPath(testCase.name);
    if (existsSync(jsonPath)) {
      unlinkSync(jsonPath);
      console.log(`Cleared cache for "${testCase.name}". Next run will use AI.`);
    } else {
      console.log(`No cache found for "${testCase.name}".`);
    }
  }
}
