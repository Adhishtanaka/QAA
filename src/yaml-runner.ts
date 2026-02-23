import yaml from 'js-yaml';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

import { callAI } from './ai';
import { tools } from './Tools';
import {
  executeTool, initBrowser, closeBrowser, getCurrentPage, takeScreenshot,
  createNewPageForViewport, clearStepTelemetry, getStepTelemetry,
  captureStorageSnapshot, capturePageMetrics,
} from './browser';
import { generatePuppeteerCode, type RecordedAction, type ActionCache } from './code-generator';
import { getSystemPrompt } from './prompt';
import { generateHTMLReport } from './report';
import { initVerbose, logAIExchange } from './verbose';
import type { StepReport, MobileRun, TestReport, ViewportConfig } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  steps: string[];
  mobileSteps?: string[]; // Optional: separate steps for mobile viewports (always run with AI)
}

type Status = 'pending' | 'running' | 'pass' | 'fail';

// ─── Mobile viewport configs ──────────────────────────────────────────────────

const MOBILE_VIEWPORTS: ViewportConfig[] = [
  { name: 'iPhone 12', width: 390, height: 844 },
  { name: 'iPad', width: 768, height: 1024 },
];

// ─── YAML parsing ─────────────────────────────────────────────────────────────

function parseYaml(filePath: string): TestCase {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content) as any;
  if (!parsed?.name || !Array.isArray(parsed?.steps))
    throw new Error('YAML must have "name" (string) and "steps" (array) fields');
  return {
    name: parsed.name,
    steps: parsed.steps.map(String),
    mobileSteps: Array.isArray(parsed.mobile_steps) ? parsed.mobile_steps.map(String) : undefined,
  };
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
function generatedCodePath(name: string) { return join(GENERATED_DIR, `${slugify(name)}.ts`); }
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
  viewportHint?: string
): Promise<{ success: boolean; error?: string; actions: RecordedAction[]; debugLines?: string }> {
  const systemPrompt = viewportHint
    ? getSystemPrompt(currentUrl) + `\n\nNOTE: Currently testing in ${viewportHint} mobile viewport. Layout and button labels may differ from desktop.`
    : getSystemPrompt(currentUrl);

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
      // Final text response — log the exchange and check for FAIL:
      const content = typeof message.content === 'string' ? message.content : '';
      logAIExchange(step, messages, content);
      // Detect FAIL: anywhere in the response (AI sometimes adds context before the marker)
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

// ─── Mobile step: hybrid (navigation cached, interactions always AI) ──────────
// Layout-independent tools (navigate, keyboard, waits) replay from cache —
// they behave identically on all devices.
// Interaction tools (click, type) ALWAYS use AI — even when the desktop selector
// exists in the mobile DOM, a raw JS click bypasses React/framework event
// handlers and doesn't trigger the correct mobile UI behaviour.

const ALWAYS_CACHED_TOOLS = new Set([
  'navigate_to', 'press_enter', 'wait_for_element',
  'get_page_elements', 'get_page_content', 'get_markdown',
]);

async function runMobileStep(
  step: string,
  stepActions: RecordedAction[],
  currentUrl: string,
  viewportName: string
): Promise<{ success: boolean; error?: string; usedAI: boolean; debugLines?: string }> {
  const needsInteraction = stepActions.some(a => !ALWAYS_CACHED_TOOLS.has(a.tool));
  const isVerifyStep = /\b(verify|check|confirm|assert|ensure|validate)\b/i.test(step);
  if (needsInteraction || isVerifyStep) {
    const url = getCurrentPage()?.url() ?? currentUrl;
    const aiResult = await runStepWithAI(step, url, viewportName);
    return { success: aiResult.success, error: aiResult.error, usedAI: true, debugLines: aiResult.debugLines };
  }

  // Navigation / read-only only — replay from cache
  for (const action of stepActions) {
    try {
      const result = await executeTool(action.tool, action.args);
      if (result.startsWith('ERROR:')) return { success: false, error: result, usedAI: false };
    } catch (err: any) {
      return { success: false, error: `${action.tool} failed: ${err.message}`, usedAI: false };
    }
  }
  return { success: true, usedAI: false };
}

// ─── Empty step report helper ─────────────────────────────────────────────────

function emptyStep(description: string): StepReport {
  return { description, status: 'pending', screenshot: '' };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function runTest(yamlPath: string): Promise<void> {
  const testCase = parseYaml(yamlPath);
  const hash = computeHash(testCase.steps);
  const jsonPath = cacheJsonPath(testCase.name);
  const codePath = generatedCodePath(testCase.name);

  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

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

  await initBrowser();

  const allActions: RecordedAction[] = [];
  let passed = 0;
  let failed = 0;

  // ── Desktop run ────────────────────────────────────────────────────────────

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
      writeFileSync(codePath, generatePuppeteerCode(testCase.name, hash, allActions));
    }
  }

  const desktopSummary = failed === 0
    ? `${GREEN}Desktop: All ${passed} steps passed!${RESET}`
    : `Desktop: ${passed} passed, ${RED}${failed} failed${RESET}`;
  renderChecklist(testCase.name, testCase.steps, statuses, desktopSummary);
  for (const f of desktopFailures) {
    process.stdout.write(`  ${RED}✗ Step ${f.num} failed:${RESET} ${f.error ?? 'unknown error'}\n`);
    if (f.debugLines) process.stdout.write(f.debugLines);
  }
  if (desktopFailures.length > 0) lastRenderLines = 0;

  // ── Mobile runs ───────────────────────────────────────────────────────────

  // Build action lookup for the hybrid approach (used only when mobile_steps is absent)
  const effectiveActions = allActions.length > 0 ? allActions : (cachedActions ?? []);
  const actionsByStep = new Map<string, RecordedAction[]>();
  for (const action of effectiveActions) {
    const list = actionsByStep.get(action.step) ?? [];
    list.push(action);
    actionsByStep.set(action.step, list);
  }

  // Steps to run on mobile: use mobile_steps if defined, otherwise fall back to desktop steps
  const mobileRunSteps = testCase.mobileSteps ?? testCase.steps;
  const usingCustomMobileSteps = testCase.mobileSteps !== undefined;

  if (usingCustomMobileSteps) {
    process.stdout.write(`  ${DIM}Using mobile_steps from YAML (all steps run with AI)${RESET}\n`);
    lastRenderLines = 0;
  }

  const mobileRuns: MobileRun[] = [];

  for (const viewport of MOBILE_VIEWPORTS) {
    process.stdout.write(`  ${DIM}Mobile: ${viewport.name} (${viewport.width}×${viewport.height})...${RESET}\n`);
    lastRenderLines = 0;

    // Fresh page per viewport ensures correct dimensions before first navigation
    await createNewPageForViewport(viewport);

    const mobileStatuses: Status[] = mobileRunSteps.map(() => 'pending');
    const mobileStepReports: StepReport[] = mobileRunSteps.map(desc => emptyStep(desc));
    let mobilePassed = 0;
    let mobileFailed = 0;
    let mobileAborted = false;
    const mobileFailures: FailInfo[] = [];

    for (let i = 0; i < mobileRunSteps.length; i++) {
      const step = mobileRunSteps[i]!;

      if (mobileAborted) {
        mobileStatuses[i] = 'fail'; mobileFailed++;
        mobileStepReports[i] = { description: step, status: 'fail', screenshot: '', error: 'Skipped — previous step failed' };
        continue;
      }

      mobileStatuses[i] = 'running';
      renderChecklist(
        `${testCase.name} — ${viewport.name}`,
        mobileRunSteps, mobileStatuses,
        `Mobile step ${i + 1}/${mobileRunSteps.length}...`
      );

      const stepStartMs = Date.now();
      let result: { success: boolean; error?: string; usedAI: boolean; debugLines?: string };

      if (usingCustomMobileSteps) {
        const url = getCurrentPage()?.url() ?? 'about:blank';
        const aiResult = await withTimeout(
          runStepWithAI(step, url, viewport.name),
          STEP_TIMEOUT_MS, step
        ).catch(err => ({ success: false, error: err.message, actions: [] as RecordedAction[], debugLines: undefined }));
        result = { success: aiResult.success, error: aiResult.error, usedAI: true, debugLines: aiResult.debugLines };
      } else {
        const currentUrl = getCurrentPage()?.url() ?? 'about:blank';
        const stepActions = actionsByStep.get(step) ?? [];
        result = await withTimeout(
          runMobileStep(step, stepActions, currentUrl, viewport.name),
          STEP_TIMEOUT_MS, step
        ).catch(err => ({ success: false, error: err.message, usedAI: false, debugLines: undefined }));
      }

      const screenshot = await takeScreenshot();
      const metrics = await capturePageMetrics(stepStartMs);

      if (result.success) {
        mobileStatuses[i] = 'pass'; mobilePassed++;
        mobileStepReports[i] = { description: step, status: 'pass', screenshot, metrics, usedAI: result.usedAI };
      } else {
        mobileStatuses[i] = 'fail'; mobileFailed++;
        mobileStepReports[i] = { description: step, status: 'fail', screenshot, error: result.error, metrics, usedAI: result.usedAI };
        mobileAborted = true;
        mobileFailures.push({ num: i + 1, error: result.error, debugLines: result.debugLines });
      }
    }

    const mobileSummary = mobileFailed === 0
      ? `${GREEN}${viewport.name}: All ${mobilePassed} steps passed!${RESET}`
      : `${viewport.name}: ${mobilePassed} passed, ${RED}${mobileFailed} failed${RESET}`;
    renderChecklist(`${testCase.name} — ${viewport.name}`, mobileRunSteps, mobileStatuses, mobileSummary);
    for (const f of mobileFailures) {
      process.stdout.write(`  ${RED}✗ Step ${f.num} failed:${RESET} ${f.error ?? 'unknown error'}\n`);
      if (f.debugLines) process.stdout.write(f.debugLines);
    }
    if (mobileFailures.length > 0) lastRenderLines = 0;

    mobileRuns.push({ viewport, steps: mobileStepReports });
  }

  // ── Generate report ────────────────────────────────────────────────────────

  // Read generated code before deleting the file
  const generatedCode = existsSync(codePath) ? readFileSync(codePath, 'utf-8') : '';

  const report: TestReport = {
    testName: testCase.name,
    timestamp,
    desktopSteps,
    mobileRuns,
    generatedCode,
  };

  const html = generateHTMLReport(report, process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL);
  const rptPath = reportPath(testCase.name, timestamp);
  writeFileSync(rptPath, html);

  // Delete .ts file — code is now embedded in the report
  if (existsSync(codePath)) unlinkSync(codePath);

  console.log(`  Report:  ${rptPath}`);
  if (!usingCache && failed === 0)
    console.log(`  ${DIM}Next run replays actions directly — no AI needed.${RESET}`);
  if (usingCache && failed > 0)
    console.log(`\n  ${YELLOW}Cached actions failed. Run: bun src/index.ts clear ${yamlPath}${RESET}`);

  console.log('');

  await closeBrowser();
  if (failed > 0) process.exit(1);
}

// ─── Cache clear ──────────────────────────────────────────────────────────────

export function clearCache(yamlPath: string): void {
  const testCase = parseYaml(yamlPath);
  const jsonPath = cacheJsonPath(testCase.name);
  const codePath = generatedCodePath(testCase.name);
  let cleared = false;
  for (const p of [jsonPath, codePath]) {
    if (existsSync(p)) { unlinkSync(p); cleared = true; }
  }
  console.log(cleared
    ? `Cleared cache for "${testCase.name}". Next run will use AI.`
    : `No cache found for "${testCase.name}".`
  );
}
