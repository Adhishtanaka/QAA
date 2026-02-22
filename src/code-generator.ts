export interface RecordedAction {
  tool: string;
  args: Record<string, any>;
  step: string;
}

export interface ActionCache {
  hash: string;
  testName: string;
  actions: RecordedAction[];
}

function esc(str: string): string {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function toolToCode(action: RecordedAction): string {
  switch (action.tool) {
    case 'navigate_to':
      return [
        `  await page.goto('${esc(action.args.url)}', { waitUntil: 'networkidle0', timeout: 60000 });`,
        `  await new Promise(r => setTimeout(r, 2000));`,
      ].join('\n');

    case 'click_element':
      return [
        `  try { await page.waitForSelector('${esc(action.args.selector)}', { timeout: 5000 }); } catch (_) {}`,
        `  await page.click('${esc(action.args.selector)}');`,
        `  await new Promise(r => setTimeout(r, 1500));`,
      ].join('\n');

    case 'type_text':
      return [
        `  await page.waitForSelector('${esc(action.args.selector)}', { timeout: 5000 });`,
        `  await page.click('${esc(action.args.selector)}');`,
        `  await page.evaluate(sel => { const el = document.querySelector(sel) as HTMLInputElement; if (el) el.value = ''; }, '${esc(action.args.selector)}');`,
        `  await page.type('${esc(action.args.selector)}', '${esc(action.args.text)}', { delay: 50 });`,
      ].join('\n');

    case 'press_enter':
      return [
        `  await page.keyboard.press('Enter');`,
        `  await new Promise(r => setTimeout(r, 2000));`,
      ].join('\n');

    case 'wait_for_element':
      return `  await page.waitForSelector('${esc(action.args.selector)}', { timeout: ${action.args.timeout || 10000} });`;

    // Read-only tools — skip in generated code
    case 'get_page_elements':
    case 'get_page_content':
    case 'get_markdown':
      return '';

    default:
      return `  // [skipped: ${action.tool}]`;
  }
}

function buildStepsBody(actions: RecordedAction[]): string[] {
  const lines: string[] = [];
  let lastStep = '';
  for (const action of actions) {
    if (action.step !== lastStep) {
      lines.push('');
      lines.push(`  // Step: ${action.step}`);
      lastStep = action.step;
    }
    const code = toolToCode(action);
    if (code) lines.push(code);
  }
  return lines;
}

export function generatePuppeteerCode(testName: string, hash: string, actions: RecordedAction[]): string {
  const lines: string[] = [];

  lines.push(`// QAA Generated Code — ${testName} (multi-device)`);
  lines.push(`// hash: ${hash}`);
  lines.push(`// Run directly: bun generated/<file>.ts`);
  lines.push('');
  lines.push(`import puppeteer from 'puppeteer';`);
  lines.push('');

  // ── Shared steps ────────────────────────────────────────────────────────────
  lines.push(`// ── Shared steps ─────────────────────────────────────────────────────────────`);
  lines.push(`async function runSteps(page: any): Promise<void> {`);
  lines.push(...buildStepsBody(actions));
  lines.push(`}`);
  lines.push('');

  // ── Desktop ─────────────────────────────────────────────────────────────────
  lines.push(`// ── Desktop ──────────────────────────────────────────────────────────────────`);
  lines.push(`async function runDesktop(): Promise<void> {`);
  lines.push(`  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });`);
  lines.push(`  const page = await browser.newPage();`);
  lines.push(`  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');`);
  lines.push(`  await runSteps(page);`);
  lines.push(`  console.log('✓ Desktop: ${esc(testName)}');`);
  lines.push(`  await browser.close();`);
  lines.push(`}`);
  lines.push('');

  // ── iPhone 12 ───────────────────────────────────────────────────────────────
  lines.push(`// ── iPhone 12 (390×844) ─────────────────────────────────────────────────────`);
  lines.push(`async function runIPhone12(): Promise<void> {`);
  lines.push(`  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });`);
  lines.push(`  const page = await browser.newPage();`);
  lines.push(`  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });`);
  lines.push(`  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');`);
  lines.push(`  await runSteps(page);`);
  lines.push(`  console.log('✓ iPhone 12: ${esc(testName)}');`);
  lines.push(`  await browser.close();`);
  lines.push(`}`);
  lines.push('');

  // ── iPad ────────────────────────────────────────────────────────────────────
  lines.push(`// ── iPad (768×1024) ──────────────────────────────────────────────────────────`);
  lines.push(`async function runIPad(): Promise<void> {`);
  lines.push(`  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });`);
  lines.push(`  const page = await browser.newPage();`);
  lines.push(`  await page.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true });`);
  lines.push(`  await page.setUserAgent('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');`);
  lines.push(`  await runSteps(page);`);
  lines.push(`  console.log('✓ iPad: ${esc(testName)}');`);
  lines.push(`  await browser.close();`);
  lines.push(`}`);
  lines.push('');

  // ── Main ────────────────────────────────────────────────────────────────────
  lines.push(`// ── Run all devices ──────────────────────────────────────────────────────────`);
  lines.push(`async function main(): Promise<void> {`);
  lines.push(`  await runDesktop();`);
  lines.push(`  await runIPhone12();`);
  lines.push(`  await runIPad();`);
  lines.push(`  console.log('\\n✓ All devices passed: ${esc(testName)}');`);
  lines.push(`}`);
  lines.push('');
  lines.push(`main().catch(err => {`);
  lines.push(`  console.error('✗ Test failed:', err.message);`);
  lines.push(`  process.exit(1);`);
  lines.push(`});`);

  return lines.join('\n') + '\n';
}
