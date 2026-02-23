import { runTest, clearCache } from './yaml-runner';
import { listAvailableBrowsers, detectBrowser } from './browser';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as readline from 'readline';

const BOLD  = '\x1B[1m';
const DIM   = '\x1B[2m';
const GREEN = '\x1B[32m';
const RED   = '\x1B[31m';
const CYAN  = '\x1B[36m';
const BLUE  = '\x1B[34m';
const RESET = '\x1B[0m';

function printLogo() {
  process.stdout.write(`
${CYAN}${BOLD}   ██████╗  █████╗  █████╗ ${RESET}
${CYAN}${BOLD}  ██╔═══██╗██╔══██╗██╔══██╗${RESET}
${CYAN}${BOLD}  ██║   ██║███████║███████║${RESET}
${CYAN}${BOLD}  ██║▄▄ ██║██╔══██║██╔══██║${RESET}
${CYAN}${BOLD}  ╚██████╔╝██║  ██║██║  ██║${RESET}
${CYAN}${BOLD}   ╚══▀▀═╝ ╚═╝  ╚═╝╚═╝  ╚═╝${RESET}
${DIM}  Quality Assurance Agent${RESET}  ${BLUE}made by adhishtanaka${RESET}
`);
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

const allArgs = process.argv.slice(2);
const noLogo  = allArgs.includes('--no-logo');
const args    = allArgs.filter(a => a !== '--no-logo');
const [subcommand, ...rest] = args;

if (!noLogo) printLogo();

const RESERVED = new Set(['setup', 'clear', 'serve', '--help', '-h']);

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  printHelp();
  process.exit(0);
}

if (subcommand === 'setup') {
  runSetup().catch(fatal);
} else if (subcommand === 'clear') {
  if (!rest[0]) { console.error('Usage: bun src/index.ts clear <test.yaml>'); process.exit(1); }
  clearCache(rest[0]);
} else if (subcommand === 'serve') {
  serveReport(rest[0]).catch(fatal);
} else if (args.length > 1 && args.every(a => !RESERVED.has(a))) {
  // Multiple YAML paths — run all in parallel
  runParallel(args).catch(fatal);
} else {
  // Single YAML file
  runTest(subcommand).catch(fatal);
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${BOLD}  QAA — Quality Assurance Agent${RESET}
  ${DIM}AI-driven browser testing from simple YAML files${RESET}

${BOLD}  Usage${RESET}
    ${CYAN}bun src/index.ts <test.yaml>${RESET}                  Run a single test
    ${CYAN}bun src/index.ts <t1.yaml> <t2.yaml> ...${RESET}      Run multiple tests in parallel
    ${CYAN}bun src/index.ts setup${RESET}                        Configure your browser
    ${CYAN}bun src/index.ts clear <test.yaml>${RESET}            Clear cached actions (force AI re-run)
    ${CYAN}bun src/index.ts serve <slug>${RESET}                 Serve latest report over HTTP

${BOLD}  YAML format${RESET}
    name: "My Test"
    steps:
      - Navigate to https://example.com
      - Click the Sign In button
      - Type "user@email.com" in the email field
      - Verify the dashboard is shown

${BOLD}  What it does${RESET}
    • First run: AI executes each step, records actions, generates a script
    • Next runs:  replays the generated script — no AI needed
    • Saves an HTML report with screenshots after each run

${BOLD}  Environment (.env)${RESET}
    GEMINI_API_KEY=...        Required — get one at aistudio.google.com
    GEMINI_MODEL=gemini-2.0-flash
    BROWSER_PATH=...          Optional — set by "setup" command
`);
}

// ─── Parallel runner ──────────────────────────────────────────────────────────

async function runParallel(yamlPaths: string[]) {
  console.log(`  Running ${BOLD}${yamlPaths.length} tests in parallel${RESET}...\n`);

  const bunBin    = process.argv[0]!;
  const scriptPath = process.argv[1]!;

  const results = await Promise.all(yamlPaths.map(async (yamlPath) => {
    const proc = Bun.spawn([bunBin, scriptPath, '--no-logo', yamlPath], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    return { yamlPath, stdout, stderr, exitCode };
  }));

  for (const { yamlPath, stdout, stderr, exitCode } of results) {
    const statusColor = exitCode === 0 ? GREEN : RED;
    const statusIcon  = exitCode === 0 ? '✓' : '✗';
    process.stdout.write(`\n${statusColor}${BOLD}  ${statusIcon} ${yamlPath}${RESET}\n`);
    process.stdout.write(`  ${'─'.repeat(58)}\n`);
    if (stdout.trim()) process.stdout.write(stdout.replace(/^/gm, '  '));
    if (stderr.trim()) process.stderr.write(stderr.replace(/^/gm, '  '));
  }

  const failed = results.filter(r => r.exitCode !== 0).length;
  const passed = results.length - failed;

  process.stdout.write(`\n  ${'─'.repeat(58)}\n`);
  if (failed > 0) {
    process.stdout.write(`  ${RED}${BOLD}${failed}/${results.length} tests failed${RESET}\n\n`);
    process.exit(1);
  } else {
    process.stdout.write(`  ${GREEN}${BOLD}All ${passed} tests passed${RESET}\n\n`);
  }
}

// ─── Setup wizard ─────────────────────────────────────────────────────────────

async function runSetup() {
  console.log(`\n${BOLD}  QAA Setup${RESET}\n`);

  // 1. Check current browser
  const current = detectBrowser();
  if (current) {
    console.log(`  ${GREEN}Browser already configured:${RESET} ${current}`);
    const ok = await ask('  Use this browser? [Y/n]: ');
    if (ok.toLowerCase() !== 'n') {
      writeBrowserPath(current);
      console.log(`  ${GREEN}✓ Saved to .env${RESET}\n`);
      return;
    }
  }

  // 2. List available browsers
  const found = listAvailableBrowsers();
  if (found.length === 0) {
    console.log('  No Chromium-based browsers found automatically.\n');
    const custom = await ask('  Enter full path to your browser executable: ');
    if (custom && existsSync(custom)) {
      writeBrowserPath(custom);
      console.log(`  ${GREEN}✓ Saved BROWSER_PATH=${custom}${RESET}\n`);
    } else {
      console.error('  Path not found. Install Chrome, Brave, or another Chromium-based browser.');
    }
    return;
  }

  console.log('  Found Chromium-based browsers:\n');
  found.forEach((b, i) => console.log(`    ${i + 1}. ${b.name}  ${DIM}${b.path}${RESET}`));
  console.log(`    ${found.length + 1}. Enter custom path\n`);

  const choice = await ask(`  Select [1-${found.length + 1}]: `);
  const idx = parseInt(choice, 10) - 1;

  if (idx >= 0 && idx < found.length) {
    writeBrowserPath(found[idx]!.path);
    console.log(`  ${GREEN}✓ Saved: ${found[idx]!.name}${RESET}\n`);
  } else if (idx === found.length) {
    const custom = await ask('  Enter full path: ');
    if (custom && existsSync(custom)) {
      writeBrowserPath(custom);
      console.log(`  ${GREEN}✓ Saved BROWSER_PATH=${custom}${RESET}\n`);
    } else {
      console.error('  Path not found.');
    }
  } else {
    console.error('  Invalid selection.');
  }
}

// ─── Serve ────────────────────────────────────────────────────────────────────

async function serveReport(slug: string | undefined) {
  const reportsDir = 'reports';
  if (!existsSync(reportsDir)) {
    console.error('  No reports directory found. Run a test first.');
    process.exit(1);
  }

  const files = readdirSync(reportsDir).filter(f => f.endsWith('.html'));
  if (files.length === 0) {
    console.error('  No HTML reports found in ./reports/');
    process.exit(1);
  }

  let target: string;
  if (slug) {
    const match = files
      .filter(f => f.includes(slug))
      .sort()
      .at(-1);
    if (!match) {
      console.error(`  No report matching "${slug}" found in ./reports/`);
      console.error(`  Available: ${files.slice(-5).join(', ')}`);
      process.exit(1);
    }
    target = match;
  } else {
    target = files.sort().at(-1)!;
  }

  const reportPath = join(reportsDir, target);
  const html = readFileSync(reportPath);
  const port = 4321;

  Bun.serve({
    port,
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === '/' || url.pathname === `/${target}`) {
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      return new Response('Not found', { status: 404 });
    },
  });

  console.log(`\n  ${GREEN}Serving:${RESET} ${target}`);
  console.log(`  ${CYAN}${BOLD}http://localhost:${port}/${RESET}\n`);
  console.log(`  ${DIM}Press Ctrl+C to stop${RESET}\n`);

  // Keep alive
  await new Promise(() => {});
}

function writeBrowserPath(browserPath: string) {
  const envFile = '.env';
  let content = existsSync(envFile) ? readFileSync(envFile, 'utf-8') : '';
  if (content.includes('BROWSER_PATH=')) {
    content = content.replace(/^BROWSER_PATH=.*$/m, `BROWSER_PATH=${browserPath}`);
  } else {
    content = content.trimEnd() + `\nBROWSER_PATH=${browserPath}\n`;
  }
  writeFileSync(envFile, content);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); }));
}

function fatal(err: Error) {
  console.error(`\n  Fatal: ${err.message}`);
  process.exit(1);
}
