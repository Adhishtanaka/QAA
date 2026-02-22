const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

// Gemini free-tier / preview models have tighter RPM limits.
// Add a small mandatory gap between every outgoing request to stay under RPM.
const MIN_REQUEST_INTERVAL_MS = 3_000; // ≤ 20 RPM comfortably
let lastRequestAt = 0;

// Proactive token-window tracking (populated from response headers when available)
let remainingTokens: number | null = null;
let tokenResetMs: number | null = null;
const LOW_TOKEN_THRESHOLD = 50_000;

const MAX_RETRIES = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Parse "7.66s" or "2m3.5s" → milliseconds */
function parseResetDuration(value: string): number {
  const m = value.match(/(\d+(?:\.\d+)?)m/);
  const s = value.match(/(?:^|m)(\d+(?:\.\d+)?)s/);
  return Math.ceil(((m ? parseFloat(m[1]!) : 0) * 60 + (s ? parseFloat(s[1]!) : 0)) * 1000);
}

function trackHeaders(headers: Headers): void {
  const remaining = headers.get('x-ratelimit-remaining-tokens');
  const resetIn = headers.get('x-ratelimit-reset-tokens');
  if (remaining !== null) remainingTokens = parseInt(remaining, 10);
  if (resetIn !== null) tokenResetMs = Date.now() + parseResetDuration(resetIn);
}

/** Enforce minimum gap between requests (RPM guard) */
async function enforceRequestInterval(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await sleep(MIN_REQUEST_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
}

/** Wait until the token window resets if we're running low (TPM guard) */
async function throttleIfTokensLow(): Promise<void> {
  if (remainingTokens === null || remainingTokens > LOW_TOKEN_THRESHOLD) return;
  if (!tokenResetMs) return;
  const waitMs = tokenResetMs - Date.now();
  if (waitMs <= 0) return;
  process.stderr.write(`  [rate limit] ${remainingTokens} tokens left — waiting ${Math.ceil(waitMs / 1000)}s for TPM reset...\n`);
  await sleep(waitMs + 300);
  remainingTokens = null;
  tokenResetMs = null;
}

/** Resolve how long to wait on a 429. Precedence:
 *  1. Retry-After header (authoritative)
 *  2. Stored token-reset window
 *  3. Exponential backoff: 5s · 2^attempt */
function resolveWaitMs(headers: Headers, attempt: number): number {
  const header = headers.get('retry-after') ?? headers.get('Retry-After');
  if (header) return parseInt(header, 10) * 1000 + 300;
  if (tokenResetMs) return Math.max(tokenResetMs - Date.now(), 0) + 300;
  return 5_000 * Math.pow(2, attempt); // exponential backoff
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function callAI(messages: any[], tools?: any[]): Promise<any> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env');

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

  const body: any = { model, messages, max_tokens: 4096, temperature: 0.1 };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await throttleIfTokensLow();
    await enforceRequestInterval();

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    trackHeaders(response.headers);

    if (response.ok) return response.json();

    const text = await response.text();

    if (response.status === 429) {
      if (attempt === MAX_RETRIES) throw new Error(`Rate limit exceeded after ${MAX_RETRIES} retries: ${text}`);
      const waitMs = resolveWaitMs(response.headers, attempt);
      process.stderr.write(`  [rate limit] 429 — waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt + 1}/${MAX_RETRIES}...\n`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Gemini API error ${response.status}: ${text}`);
  }
}
