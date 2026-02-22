import { mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

const VERBOSE_DIR = 'verbose';

let verboseFilePath: string | null = null;

export function initVerbose(slug: string, timestamp: string): void {
  mkdirSync(VERBOSE_DIR, { recursive: true });
  verboseFilePath = join(VERBOSE_DIR, `${slug}-${timestamp}.jsonl`);
}

interface AlpacaEntry {
  instruction: string;
  input: string;
  output: string;
}

/**
 * Appends one Alpaca-format JSONL entry for a completed AI step.
 * @param step   - the natural-language test step description
 * @param messages - the full message array sent to the AI (includes system + user)
 * @param finalOutput - the last text response from the AI (no tool calls)
 */
export function logAIExchange(step: string, messages: any[], finalOutput: string): void {
  if (!verboseFilePath) return;

  const systemMsg = messages.find((m: any) => m.role === 'system');
  const entry: AlpacaEntry = {
    instruction: typeof systemMsg?.content === 'string' ? systemMsg.content : '',
    input: `Execute this test step: ${step}`,
    output: finalOutput,
  };

  appendFileSync(verboseFilePath, JSON.stringify(entry) + '\n');
}
