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

export function generatePuppeteerCode(testName: string, hash: string, actions: RecordedAction[]): string {
  const lines: string[] = [];

  lines.push(`// QAA Generated Code — ${testName}`);
  lines.push(`// hash: ${hash}`);
  lines.push(`// Run directly: bun generated/<file>.ts`);
  lines.push('');
  lines.push(`import puppeteer from 'puppeteer';`);
  lines.push('');
  lines.push(`async function run() {`);
  lines.push(`  const browser = await puppeteer.launch({ headless: false, defaultViewport: null });`);
  lines.push(`  const page = await browser.newPage();`);
  lines.push(`  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');`);

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

  lines.push('');
  lines.push(`  console.log('✓ Test passed: ${esc(testName)}');`);
  lines.push(`  await browser.close();`);
  lines.push(`}`);
  lines.push('');
  lines.push(`run().catch(err => {`);
  lines.push(`  console.error('✗ Test failed:', err.message);`);
  lines.push(`  process.exit(1);`);
  lines.push(`});`);

  return lines.join('\n') + '\n';
}
