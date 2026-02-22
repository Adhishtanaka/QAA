import yaml from 'js-yaml';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

import { callAI } from './ai';
import { tools } from './Tools';
import { executeTool, initBrowser, closeBrowser, getCurrentPage, startRecording, stopRecording } from './browser';
import { generatePuppeteerCode, type RecordedAction, type ActionCache } from './code-generator';
import { getSystemPrompt } from './prompt';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TestCase {
  name: string;
  steps: string[];
}

type Status = 'pending' | 'running' | 'pass' | 'fail';

// ─── YAML parsing ─────────────────────────────────────────────────────────────

function parseYaml(filePath: string): TestCase {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content) as any;
  if (!parsed?.name || !Array.isArray(parsed?.steps)) {
    throw new Error('YAML must have "name" (string) and "steps" (array) fields');
  }
  return { name: parsed.name, steps: parsed.steps.map(String) };
}

// ─── Hashing & paths ──────────────────────────────────────────────────────────

function computeHash(steps: string[]): string {
  return createHash('sha256').update(steps.join('\n')).digest('hex').slice(0, 12);
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

const GENERATED_DIR = 'generated';
const RECORDINGS_DIR = 'recordings';

function cacheJsonPath(name: string) {
  return join(GENERATED_DIR, `${slugify(name)}.json`);
}

function generatedCodePath(name: string) {
  return join(GENERATED_DIR, `${slugify(name)}.ts`);
}

// ─── Checklist rendering ──────────────────────────────────────────────────────

const GREEN = '\x1B[32m';
const RED = '\x1B[31m';
const YELLOW = '\x1B[33m';
const DIM = '\x1B[2m';
const RESET = '\x1B[0m';
const BOLD = '\x1B[1m';

function icon(s: Status): string {
  if (s === 'pass') return `${GREEN}[✓]${RESET}`;
  if (s === 'fail') return `${RED}[✗]${RESET}`;
  if (s === 'running') return `${YELLOW}[~]${RESET}`;
  return `${DIM}[ ]${RESET}`;
}

let lastRenderLines = 0;

function renderChecklist(name: string, steps: string[], statuses: Status[], info = '') {
  // Move cursor up to overwrite previous render
  if (lastRenderLines > 0) {
    process.stdout.write(`\x1B[${lastRenderLines}A\x1B[0J`);
  }

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

// ─── AI step executor ─────────────────────────────────────────────────────────

async function runStepWithAI(
  step: string,
  currentUrl: string
): Promise<{ success: boolean; error?: string; actions: RecordedAction[] }> {
  const messages: any[] = [
    { role: 'system', content: getSystemPrompt(currentUrl) },
    { role: 'user', content: `Execute this test step: ${step}` },
  ];

  const actions: RecordedAction[] = [];
  const MAX_ITER = 15;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await callAI(messages, tools);
    const message = response.choices[0]?.message;
    if (!message) throw new Error('No response from AI');

    messages.push(message);

    // AI done with this step — no more tool calls
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { success: true, actions };
    }

    for (const toolCall of message.tool_calls) {
      const toolName: string = toolCall.function.name;
      let toolArgs: any;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        toolArgs = {};
      }

      actions.push({ tool: toolName, args: toolArgs, step });

      let result: string;
      try {
        result = await executeTool(toolName, toolArgs);
      } catch (err: any) {
        result = `ERROR: ${err.message}`;
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: result,
      });
    }
  }

  return { success: false, error: 'Max iterations reached', actions };
}

// ─── Cached replay executor ───────────────────────────────────────────────────

async function runStepFromCache(
  step: string,
  stepActions: RecordedAction[]
): Promise<{ success: boolean; error?: string }> {
  for (const action of stepActions) {
    try {
      await executeTool(action.tool, action.args);
    } catch (err: any) {
      return { success: false, error: `${action.tool} failed: ${err.message}` };
    }
  }
  return { success: true };
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function runTest(yamlPath: string): Promise<void> {
  const testCase = parseYaml(yamlPath);
  const hash = computeHash(testCase.steps);
  const jsonPath = cacheJsonPath(testCase.name);
  const codePath = generatedCodePath(testCase.name);

  mkdirSync(GENERATED_DIR, { recursive: true });
  mkdirSync(RECORDINGS_DIR, { recursive: true });

  // Check cache
  let cachedActions: RecordedAction[] | null = null;
  if (existsSync(jsonPath)) {
    const cached: ActionCache = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    if (cached.hash === hash) {
      cachedActions = cached.actions;
    }
  }

  const usingCache = cachedActions !== null;
  const statuses: Status[] = testCase.steps.map(() => 'pending');

  // Recording filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const recordingPath = join(RECORDINGS_DIR, `${slugify(testCase.name)}-${timestamp}.webm`);

  lastRenderLines = 0;
  renderChecklist(
    testCase.name,
    testCase.steps,
    statuses,
    usingCache ? 'Using cached actions (no AI needed)' : 'Running with AI...'
  );

  await initBrowser();
  await startRecording(recordingPath);

  const allActions: RecordedAction[] = [];
  let passed = 0;
  let failed = 0;

  if (usingCache) {
    // Group cached actions by step
    const actionsByStep: Map<string, RecordedAction[]> = new Map();
    for (const action of cachedActions!) {
      const list = actionsByStep.get(action.step) ?? [];
      list.push(action);
      actionsByStep.set(action.step, list);
    }

    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i]!;
      statuses[i] = 'running';
      renderChecklist(testCase.name, testCase.steps, statuses, `Running step ${i + 1}/${testCase.steps.length}...`);

      const stepActions = actionsByStep.get(step) ?? [];
      const result = await runStepFromCache(step, stepActions);

      if (result.success) {
        statuses[i] = 'pass';
        passed++;
      } else {
        statuses[i] = 'fail';
        failed++;
        renderChecklist(testCase.name, testCase.steps, statuses, `Step ${i + 1} failed: ${result.error ?? 'unknown error'}`);
      }
    }
  } else {
    // AI-driven run
    for (let i = 0; i < testCase.steps.length; i++) {
      const step = testCase.steps[i]!;
      statuses[i] = 'running';
      renderChecklist(testCase.name, testCase.steps, statuses, `AI executing step ${i + 1}/${testCase.steps.length}...`);

      const currentPage = getCurrentPage();
      const currentUrl = currentPage ? currentPage.url() : 'about:blank';

      const result = await runStepWithAI(step, currentUrl);
      allActions.push(...result.actions);

      if (result.success) {
        statuses[i] = 'pass';
        passed++;
      } else {
        statuses[i] = 'fail';
        failed++;
        renderChecklist(testCase.name, testCase.steps, statuses, `Step ${i + 1} failed: ${result.error}`);
      }
    }

    // Save cache + generated code if all steps passed
    if (failed === 0) {
      const cache: ActionCache = { hash, testName: testCase.name, actions: allActions };
      writeFileSync(jsonPath, JSON.stringify(cache, null, 2));
      writeFileSync(codePath, generatePuppeteerCode(testCase.name, hash, allActions));
    }
  }

  await stopRecording();

  // Final render
  const summary = failed === 0
    ? `${GREEN}All ${passed} steps passed!${RESET}`
    : `${passed} passed, ${RED}${failed} failed${RESET}`;

  renderChecklist(testCase.name, testCase.steps, statuses, summary);
  console.log(`  Recording: ${recordingPath}`);

  if (!usingCache && failed === 0) {
    console.log(`  Generated code: ${codePath}`);
    console.log(`  ${DIM}Next run will skip AI and replay actions directly.${RESET}`);
  }

  if (usingCache && failed > 0) {
    console.log(`\n  ${YELLOW}Cached actions failed. Delete ${jsonPath} to re-run with AI.${RESET}`);
  }

  console.log('');

  await closeBrowser();

  if (failed > 0) process.exit(1);
}
