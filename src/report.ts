export interface StepReport {
  description: string;
  status: 'pass' | 'fail' | 'pending';
  screenshot: string; // base64 PNG, empty string if unavailable
  error?: string;
}

export function generateHTMLReport(
  testName: string,
  steps: StepReport[],
  generatedCode: string,
  timestamp: string
): string {
  const passed = steps.filter(s => s.status === 'pass').length;
  const failed = steps.filter(s => s.status === 'fail').length;
  const total = steps.length;
  const allPassed = failed === 0;

  const stepRows = steps.map((step, i) => {
    const icon = step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '·';
    const cls = step.status === 'pass' ? 'pass' : step.status === 'fail' ? 'fail' : 'pending';
    const screenshot = step.screenshot
      ? `<div class="screenshot"><img src="data:image/png;base64,${step.screenshot}" alt="Step ${i + 1} screenshot" loading="lazy"></div>`
      : `<div class="screenshot no-img">No screenshot</div>`;
    const errorRow = step.error
      ? `<div class="step-error">${escHtml(step.error)}</div>`
      : '';
    return `
    <div class="step ${cls}">
      <div class="step-header">
        <span class="step-icon">${icon}</span>
        <span class="step-num">${i + 1}</span>
        <span class="step-desc">${escHtml(step.description)}</span>
      </div>
      ${errorRow}
      ${screenshot}
    </div>`;
  }).join('\n');

  const codeHtml = highlightTs(generatedCode);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QAA — ${escHtml(testName)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9;line-height:1.5}
a{color:#58a6ff}

/* Header */
.header{background:#161b22;border-bottom:1px solid #30363d;padding:24px 32px;display:flex;align-items:center;gap:20px}
.header-badge{width:40px;height:40px;border-radius:8px;background:${allPassed ? '#238636' : '#b91c1c'};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.header-title{font-size:22px;font-weight:600;color:#e6edf3}
.header-meta{font-size:13px;color:#8b949e;margin-top:2px}

/* Summary bar */
.summary{display:flex;gap:12px;padding:16px 32px;background:#161b22;border-bottom:1px solid #30363d;flex-wrap:wrap}
.badge{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;letter-spacing:.4px}
.badge.pass{background:#23863633;color:#3fb950;border:1px solid #238636}
.badge.fail{background:#b91c1c33;color:#f85149;border:1px solid #b91c1c}
.badge.info{background:#1f6feb33;color:#58a6ff;border:1px solid #1f6feb}

/* Content layout */
.content{max-width:1100px;margin:0 auto;padding:32px}

/* Section headings */
.section-title{font-size:14px;font-weight:600;color:#8b949e;letter-spacing:.8px;text-transform:uppercase;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid #30363d}

/* Steps */
.steps{display:flex;flex-direction:column;gap:16px;margin-bottom:40px}
.step{border:1px solid #30363d;border-radius:8px;overflow:hidden;background:#161b22}
.step.pass{border-color:#238636}
.step.fail{border-color:#b91c1c}
.step-header{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#0d1117}
.step-icon{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.pass .step-icon{background:#23863633;color:#3fb950}
.fail .step-icon{background:#b91c1c33;color:#f85149}
.pending .step-icon{background:#21262d;color:#8b949e}
.step-num{font-size:11px;color:#8b949e;font-weight:600;min-width:20px}
.step-desc{font-size:14px;color:#e6edf3}
.step-error{padding:8px 16px;font-size:12px;color:#f85149;background:#b91c1c1a;border-top:1px solid #b91c1c33}
.screenshot{border-top:1px solid #30363d;padding:0}
.screenshot img{width:100%;display:block;max-height:480px;object-fit:cover;object-position:top}
.screenshot.no-img{padding:16px;text-align:center;font-size:12px;color:#484f58}

/* Code */
.code-wrap{border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:40px}
.code-header{background:#161b22;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #30363d}
.code-lang{font-size:12px;color:#8b949e}
pre{background:#0d1117;padding:20px;overflow-x:auto;font-size:13px;line-height:1.7;tab-size:2}
code{font-family:'JetBrains Mono','Fira Code','Cascadia Code',monospace}
.kw{color:#ff7b72}.str{color:#a5d6ff}.cmt{color:#8b949e;font-style:italic}.fn{color:#d2a8ff}.num{color:#79c0ff}.cls{color:#ffa657}
</style>
</head>
<body>
<div class="header">
  <div class="header-badge">${allPassed ? '✓' : '✗'}</div>
  <div>
    <div class="header-title">${escHtml(testName)}</div>
    <div class="header-meta">QAA Test Report · ${timestamp}</div>
  </div>
</div>
<div class="summary">
  <span class="badge info">${total} steps</span>
  <span class="badge pass">${passed} passed</span>
  ${failed > 0 ? `<span class="badge fail">${failed} failed</span>` : ''}
</div>
<div class="content">
  <div class="section-title">Steps</div>
  <div class="steps">${stepRows}</div>
  ${generatedCode ? `
  <div class="section-title">Generated Test Script</div>
  <div class="code-wrap">
    <div class="code-header">
      <span class="code-lang">TypeScript · Puppeteer</span>
    </div>
    <pre><code>${codeHtml}</code></pre>
  </div>` : ''}
</div>
</body>
</html>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Minimal TypeScript syntax highlighter — no deps */
function highlightTs(code: string): string {
  const KEYWORDS = /\b(import|from|export|async|await|const|let|var|function|return|if|else|for|while|try|catch|throw|new|typeof|instanceof|class|extends|interface|type|void|null|undefined|true|false|of|in|break|continue)\b/g;
  const STRING = /((['"`])(?:(?!\2)[^\\]|\\.)*\2|`[^`]*`)/g;
  const COMMENT = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
  const FUNCTION = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g;
  const NUMBER = /\b(\d+(?:\.\d+)?)\b/g;

  // Process in order: comments first, then strings, then keywords
  // Use placeholder technique to avoid re-processing escaped HTML
  const segments: string[] = [];
  let processed = escHtml(code);

  // Replace comments
  processed = processed.replace(escHtml('//').replace(/\//g, '/') + '[^\\n]*|/\\*[\\s\\S]*?\\*/', m =>
    `<span class="cmt">${m}</span>`
  );

  // Simple token-by-token approach
  processed = code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    // comments (must come first)
    .replace(/(\/\/[^\n]*)/g, '<span class="cmt">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="cmt">$1</span>')
    // strings (template, single, double) — simplified
    .replace(/(`[^`]*`)/g, '<span class="str">$1</span>')
    .replace(/('(?:[^'\\]|\\.)*')/g, '<span class="str">$1</span>')
    .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="str">$1</span>')
    // numbers
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="num">$1</span>')
    // keywords
    .replace(/\b(import|from|export|async|await|const|let|var|function|return|if|else|for|while|try|catch|throw|new|typeof|instanceof|class|extends|interface|type|void|null|undefined|true|false|of|in|break|continue)\b/g,
      '<span class="kw">$1</span>')
    // function calls
    .replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=\()/g, '<span class="fn">$1</span>');

  void segments; // suppress unused warning
  return processed;
}
