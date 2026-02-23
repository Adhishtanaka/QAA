import type { TestReport } from './types';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function generateHTMLReport(report: TestReport, apiKey?: string, aiModel?: string): string {
  const safeData = JSON.stringify(report).replace(/<\/script/gi, '<\\/script');
  const safeCfg = JSON.stringify({ apiKey: apiKey ?? '', model: aiModel ?? 'gemini-2.0-flash' }).replace(/<\/script/gi, '<\\/script');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QAA — ${escHtml(report.testName)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css">
<script>window.__QAA__ = ${safeData}; window.__QAA_CFG__ = ${safeCfg};</script>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#c9d1d9;line-height:1.5}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#0d1117}
::-webkit-scrollbar-thumb{background:#30363d;border-radius:3px}
/* Override prism-tomorrow to match existing theme bg */
pre[class*="language-"]{background:#010409 !important;border-radius:0 0 8px 8px;margin:0;font-size:13px;line-height:1.7}
code[class*="language-"]{font-family:'JetBrains Mono','Fira Code','Cascadia Code',monospace}
:not(pre) > code[class*="language-"]{background:#010409}
</style>
</head>
<body>
<div id="root"><div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#8b949e;font-size:14px">Loading report...</div></div>
<script type="text/babel" data-presets="react">
const { useState, useEffect, useLayoutEffect, useRef } = React;
const D = window.__QAA__;

const C = {
  bg: '#0d1117', surface: '#161b22', border: '#30363d',
  text: '#e6edf3', muted: '#8b949e',
  green: '#3fb950', greenBg: '#23863622', greenBorder: '#238636',
  red: '#f85149',  redBg: '#b91c1c22',  redBorder: '#b91c1c',
  blue: '#58a6ff', blueBg: '#1f6feb22', blueBorder: '#1f6feb',
  orange: '#ffa657', orangeBg: '#d2931222',
};

function Badge({ type, children }) {
  const styles = {
    pass: { background: C.greenBg,  color: C.green,  border: \`1px solid \${C.greenBorder}\` },
    fail: { background: C.redBg,    color: C.red,    border: \`1px solid \${C.redBorder}\` },
    info: { background: C.blueBg,   color: C.blue,   border: \`1px solid \${C.blueBorder}\` },
    ai:   { background: C.orangeBg, color: C.orange, border: \`1px solid \${C.orange}55\` },
  };
  return (
    <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, letterSpacing: '.4px', ...(styles[type] || {}) }}>
      {children}
    </span>
  );
}

function Panel({ title, count, icon, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: \`1px solid \${C.border}\` }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '10px', display: 'inline-block', transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>&#9658;</span>
        <span>{icon} {title}</span>
        {count > 0 && <span style={{ marginLeft: 'auto', background: C.border, borderRadius: '10px', padding: '1px 8px', fontSize: '11px', color: C.text }}>{count}</span>}
      </button>
      {open && <div style={{ padding: '4px 16px 16px' }}>{children}</div>}
    </div>
  );
}

function tryFmt(s) {
  if (!s) return '';
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function ApiItem({ call }) {
  const [exp, setExp] = useState(false);
  const sc = call.responseStatus || 0;
  const scColor = sc < 300 ? C.green : sc < 400 ? C.orange : C.red;
  return (
    <div style={{ border: \`1px solid \${C.border}\`, borderRadius: '6px', marginBottom: '6px', overflow: 'hidden' }}>
      <div onClick={() => setExp(e => !e)} style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', background: C.bg }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: C.blue, minWidth: '50px' }}>{call.method}</span>
        <span style={{ fontSize: '12px', color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={call.url}>{call.url}</span>
        {sc > 0 && <span style={{ fontSize: '11px', fontWeight: 600, color: scColor, flexShrink: 0 }}>{sc}</span>}
        <span style={{ fontSize: '10px', color: C.muted }}>{exp ? '▲' : '▼'}</span>
      </div>
      {exp && (
        <div style={{ padding: '12px', fontSize: '12px', borderTop: \`1px solid \${C.border}\`, background: C.surface }}>
          {call.requestPayload ? (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ color: C.muted, marginBottom: '4px', fontWeight: 600 }}>Request Payload</div>
              <pre style={{ background: '#010409', padding: '8px', borderRadius: '4px', overflow: 'auto', color: C.text, fontSize: '11px', maxHeight: '160px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{tryFmt(call.requestPayload)}</pre>
            </div>
          ) : null}
          {call.responseBody ? (
            <div>
              <div style={{ color: C.muted, marginBottom: '4px', fontWeight: 600 }}>Response Body</div>
              <pre style={{ background: '#010409', padding: '8px', borderRadius: '4px', overflow: 'auto', color: C.text, fontSize: '11px', maxHeight: '160px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{tryFmt(call.responseBody)}</pre>
            </div>
          ) : null}
          {!call.requestPayload && !call.responseBody && <span style={{ color: C.muted }}>No payload or body captured</span>}
        </div>
      )}
    </div>
  );
}

function ConsoleRow({ entry }) {
  const colors = { error: C.red, warn: C.orange, info: C.blue };
  const color = colors[entry.type] || C.muted;
  return (
    <div style={{ padding: '4px 0', borderBottom: \`1px solid \${C.border}55\`, display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '10px', fontWeight: 700, color, minWidth: '38px', paddingTop: '1px' }}>{entry.type.toUpperCase()}</span>
      <span style={{ fontSize: '12px', color: colors[entry.type] || C.text, wordBreak: 'break-word', flex: 1 }}>{entry.text}</span>
    </div>
  );
}

function StorageView({ storage }) {
  const ls = Object.entries(storage.localStorage || {});
  const ss = Object.entries(storage.sessionStorage || {});
  const ck = storage.cookies || [];
  if (!ls.length && !ss.length && !ck.length)
    return <div style={{ color: C.muted, fontSize: '12px' }}>No storage data captured</div>;

  const KVRow = ({ k, v }) => (
    <div style={{ display: 'flex', gap: '8px', padding: '3px 0', borderBottom: \`1px solid \${C.border}55\`, fontSize: '12px' }}>
      <span style={{ color: C.orange, minWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 0 }} title={k}>{k}</span>
      <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }} title={String(v)}>{String(v).slice(0, 120)}</span>
    </div>
  );

  const Section = ({ label, rows }) => rows.length === 0 ? null : (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ color: C.muted, fontSize: '11px', fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: '6px' }}>{label} ({rows.length})</div>
      {rows.map(([k, v], i) => <KVRow key={i} k={k} v={v} />)}
    </div>
  );

  return (
    <div>
      <Section label="localStorage" rows={ls} />
      <Section label="sessionStorage" rows={ss} />
      {ck.length > 0 && (
        <div>
          <div style={{ color: C.muted, fontSize: '11px', fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: '6px' }}>Cookies ({ck.length})</div>
          {ck.slice(0, 20).map((c, i) => <KVRow key={i} k={c.name} v={c.value} />)}
        </div>
      )}
    </div>
  );
}

function MetricsPanel({ metrics }) {
  if (!metrics) return null;
  const fmt = (v, unit) => v !== undefined ? \`\${v}\${unit}\` : '—';
  const items = [
    { label: 'Step Duration', value: fmt(metrics.stepDurationMs, ' ms'), color: C.blue },
    { label: 'Page Load',     value: fmt(metrics.loadTimeMs, ' ms'),     color: C.green },
    { label: 'DOM Ready',     value: fmt(metrics.domContentLoadedMs, ' ms'), color: C.orange },
    { label: 'JS Heap',       value: fmt(metrics.heapUsedMB, ' MB'),     color: C.muted },
  ];
  return (
    <div style={{ borderTop: \`1px solid \${C.border}\`, padding: '10px 16px', display: 'flex', gap: '20px', flexWrap: 'wrap', background: C.bg }}>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '10px', color: C.muted, textTransform: 'uppercase', letterSpacing: '.5px' }}>{item.label}</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: item.color }}>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function ImageModal({ src, alt, onClose }) {
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 20px', cursor: 'zoom-out' }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '100%' }}>
        <button onClick={onClose} style={{ position: 'sticky', top: 0, float: 'right', background: '#30363d', border: 'none', color: '#e6edf3', cursor: 'pointer', padding: '6px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '4px', marginBottom: '8px' }}>✕ Close</button>
        <img src={src} alt={alt} style={{ display: 'block', maxWidth: '90vw', height: 'auto', clear: 'both' }} />
      </div>
    </div>
  );
}

function StepCard({ step, index, showAI }) {
  const icon = step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '·';
  const borderColor = step.status === 'pass' ? C.greenBorder : step.status === 'fail' ? C.redBorder : C.border;
  const iconSty = {
    pass:    { background: C.greenBg, color: C.green },
    fail:    { background: C.redBg,   color: C.red },
    pending: { background: '#21262d', color: C.muted },
  }[step.status] || {};

  const [modalSrc, setModalSrc] = useState(null);
  const apiCount = step.apiCalls?.length || 0;
  const logCount = step.consoleLogs?.length || 0;
  const stor = step.storage;
  const storCount = stor
    ? Object.keys(stor.localStorage || {}).length + Object.keys(stor.sessionStorage || {}).length + (stor.cookies?.length || 0)
    : 0;

  return (
    <div style={{ border: \`1px solid \${borderColor}\`, borderRadius: '8px', overflow: 'hidden', background: C.surface, marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: C.bg }}>
        <span style={{ width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0, ...iconSty }}>{icon}</span>
        <span style={{ fontSize: '11px', color: C.muted, fontWeight: 600, minWidth: '20px' }}>{index + 1}</span>
        <span style={{ fontSize: '14px', color: C.text, flex: 1 }}>{step.description}</span>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
          {showAI && step.usedAI && <Badge type="ai">AI Assisted</Badge>}
          {apiCount > 0 && <Badge type="info">{apiCount} API call{apiCount !== 1 ? 's' : ''}</Badge>}
        </div>
      </div>

      {step.error && (
        <div style={{ padding: '8px 16px', fontSize: '12px', color: C.red, background: C.redBg, borderTop: \`1px solid \${C.redBorder}44\` }}>{step.error}</div>
      )}

      {modalSrc && <ImageModal src={modalSrc} alt={\`Step \${index + 1}\`} onClose={() => setModalSrc(null)} />}
      {step.screenshot
        ? <div onClick={() => setModalSrc(\`data:image/png;base64,\${step.screenshot}\`)} style={{ borderTop: \`1px solid \${C.border}\`, cursor: 'zoom-in', background: '#010409' }}>
            <img src={\`data:image/png;base64,\${step.screenshot}\`} alt={\`Step \${index + 1}\`} style={{ width: '100%', maxHeight: '320px', display: 'block', objectFit: 'contain', objectPosition: 'top' }} loading="lazy" />
          </div>
        : <div style={{ borderTop: \`1px solid \${C.border}\`, padding: '16px', textAlign: 'center', fontSize: '12px', color: '#484f58' }}>No screenshot available</div>
      }

      <MetricsPanel metrics={step.metrics} />

      {step.apiCalls !== undefined && (
        <Panel title="API Calls" count={apiCount} icon="&#127760;">
          {apiCount === 0
            ? <div style={{ color: C.muted, fontSize: '12px', padding: '4px 0' }}>No API calls captured</div>
            : step.apiCalls.map((c, i) => <ApiItem key={i} call={c} />)
          }
        </Panel>
      )}

      {step.consoleLogs !== undefined && (
        <Panel title="Console Logs" count={logCount} icon="&#128187;">
          {logCount === 0
            ? <div style={{ color: C.muted, fontSize: '12px', padding: '4px 0' }}>No console output captured</div>
            : step.consoleLogs.map((e, i) => <ConsoleRow key={i} entry={e} />)
          }
        </Panel>
      )}

      {stor !== undefined && (
        <Panel title="Storage and Cookies" count={storCount} icon="&#128190;">
          <StorageView storage={stor} />
        </Panel>
      )}
    </div>
  );
}

function StepsPage({ steps, title, showAI }) {
  const passed = steps.filter(s => s.status === 'pass').length;
  const failed = steps.filter(s => s.status === 'fail').length;
  const aiUsed = showAI ? steps.filter(s => s.usedAI).length : 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '18px', color: C.text, fontWeight: 600 }}>{title}</h2>
        <Badge type="info">{steps.length} steps</Badge>
        <Badge type="pass">{passed} passed</Badge>
        {failed > 0 && <Badge type="fail">{failed} failed</Badge>}
        {aiUsed > 0 && <Badge type="ai">{aiUsed} AI assisted</Badge>}
      </div>
      {steps.map((s, i) => <StepCard key={i} step={s} index={i} showAI={showAI} />)}
    </div>
  );
}

function OverviewPage() {
  const dp = D.desktopSteps.filter(s => s.status === 'pass').length;
  const df = D.desktopSteps.filter(s => s.status === 'fail').length;
  const total = D.desktopSteps.length;

  const RunCard = ({ label, sub, passed, failed, total, aiUsed }) => {
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    return (
      <div style={{ border: \`1px solid \${C.border}\`, borderRadius: '8px', padding: '16px 20px', background: C.surface }}>
        <div style={{ fontSize: '15px', color: C.text, fontWeight: 600, marginBottom: '2px' }}>{label}</div>
        {sub && <div style={{ fontSize: '12px', color: C.muted, marginBottom: '10px' }}>{sub}</div>}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <Badge type="info">{total} steps</Badge>
          <Badge type="pass">{passed} passed</Badge>
          {failed > 0 && <Badge type="fail">{failed} failed</Badge>}
          {aiUsed > 0 && <Badge type="ai">{aiUsed} AI</Badge>}
        </div>
        <div style={{ height: '5px', background: C.border, borderRadius: '3px' }}>
          <div style={{ height: '100%', width: \`\${pct}%\`, background: failed > 0 ? C.red : C.green, borderRadius: '3px' }} />
        </div>
        <div style={{ fontSize: '11px', color: C.muted, marginTop: '6px' }}>{pct}% passing</div>
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ fontSize: '22px', color: C.text, fontWeight: 700, marginBottom: '4px' }}>{D.testName}</h2>
        <div style={{ fontSize: '13px', color: C.muted }}>QAA Test Report &#183; {D.timestamp}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: '12px', marginBottom: '32px' }}>
        <RunCard label="Desktop" sub="Full viewport" passed={dp} failed={df} total={total} aiUsed={0} />
        {D.mobileRuns.map(run => {
          const mp = run.steps.filter(s => s.status === 'pass').length;
          const mf = run.steps.filter(s => s.status === 'fail').length;
          const ai = run.steps.filter(s => s.usedAI).length;
          return (
            <RunCard key={run.viewport.name}
              label={run.viewport.name}
              sub={\`\${run.viewport.width}x\${run.viewport.height} px, mobile UA\`}
              passed={mp} failed={mf} total={total} aiUsed={ai}
            />
          );
        })}
      </div>

      <div style={{ border: \`1px solid \${C.border}\`, borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ background: C.surface, padding: '10px 16px', borderBottom: \`1px solid \${C.border}\`, fontSize: '12px', fontWeight: 600, color: C.muted, letterSpacing: '.6px', textTransform: 'uppercase' }}>Step Matrix</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: C.bg }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: C.muted, fontWeight: 600, borderBottom: \`1px solid \${C.border}\`, whiteSpace: 'nowrap' }}>#</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: C.muted, fontWeight: 600, borderBottom: \`1px solid \${C.border}\` }}>Step</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', color: C.muted, fontWeight: 600, borderBottom: \`1px solid \${C.border}\`, whiteSpace: 'nowrap' }}>Desktop</th>
                {D.mobileRuns.map(r => (
                  <th key={r.viewport.name} style={{ padding: '10px 12px', textAlign: 'center', color: C.muted, fontWeight: 600, borderBottom: \`1px solid \${C.border}\`, whiteSpace: 'nowrap' }}>{r.viewport.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {D.desktopSteps.map((step, i) => (
                <tr key={i} style={{ borderBottom: \`1px solid \${C.border}44\` }}>
                  <td style={{ padding: '9px 16px', color: C.muted }}>{i + 1}</td>
                  <td style={{ padding: '9px 16px', color: C.text, maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.description}</td>
                  <td style={{ padding: '9px 16px', textAlign: 'center' }}>
                    <span style={{ color: step.status === 'pass' ? C.green : step.status === 'fail' ? C.red : C.muted, fontWeight: 700 }}>
                      {step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '·'}
                    </span>
                  </td>
                  {D.mobileRuns.map(r => {
                    const ms = r.steps[i];
                    return (
                      <td key={r.viewport.name} style={{ padding: '9px 12px', textAlign: 'center' }}>
                        <span style={{ color: ms?.status === 'pass' ? C.green : ms?.status === 'fail' ? C.red : C.muted, fontWeight: 700 }}>
                          {ms?.status === 'pass' ? '✓' : ms?.status === 'fail' ? '✗' : '·'}
                        </span>
                        {ms?.usedAI && <span style={{ fontSize: '9px', color: C.orange, marginLeft: '4px', verticalAlign: 'super' }}>AI</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CodePage() {
  const codeRef = useRef(null);

  // useLayoutEffect + manual textContent avoids React creating per-line text nodes
  // that Prism would then wrap in block elements (the "comments in divs" bug).
  useLayoutEffect(() => {
    if (codeRef.current && window.Prism) {
      codeRef.current.textContent = D.generatedCode;
      window.Prism.highlightElement(codeRef.current);
    }
  }, []);

  const downloadCode = () => {
    const blob = new Blob([D.generatedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = \`\${D.testName.replace(/\\s+/g, '-').toLowerCase()}.ts\`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '18px', color: C.text, fontWeight: 600 }}>Generated Test Script</h2>
        <button onClick={downloadCode} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: C.blueBg, color: C.blue, border: \`1px solid \${C.blueBorder}\`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          &#8659; Download .ts
        </button>
      </div>
      <div style={{ border: \`1px solid \${C.border}\`, borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ background: C.surface, padding: '10px 16px', borderBottom: \`1px solid \${C.border}\`, fontSize: '12px', color: C.muted }}>TypeScript &#183; Puppeteer</div>
        <pre className="language-typescript" style={{ margin: 0 }}>
          <code ref={codeRef} className="language-typescript" />
        </pre>
      </div>
    </div>
  );
}

function Sidebar({ pages, active, setActive }) {
  return (
    <div style={{ width: '210px', flexShrink: 0, background: C.surface, borderRight: \`1px solid \${C.border}\`, display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
      <div style={{ padding: '16px', borderBottom: \`1px solid \${C.border}\` }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: C.text }}>QAA Report</div>
        <div style={{ fontSize: '11px', color: C.muted, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{D.testName}</div>
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {pages.map(p => (
          <button key={p.id} onClick={() => setActive(p.id)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '7px 16px',
            background: active === p.id ? '#1f6feb18' : 'none', border: 'none',
            borderLeft: active === p.id ? \`3px solid \${C.blue}\` : '3px solid transparent',
            cursor: 'pointer', color: active === p.id ? C.blue : C.muted,
            fontSize: '13px', fontWeight: active === p.id ? 600 : 400,
          }}>
            {p.label}
          </button>
        ))}
      </nav>
      <div style={{ padding: '12px 16px', borderTop: \`1px solid \${C.border}\`, fontSize: '11px', color: '#484f58', textAlign: 'center' }}>
        made by <span style={{ color: C.blue, fontWeight: 600 }}>Adhishtanaka</span>
      </div>
    </div>
  );
}

function App() {
  const pages = [
    { id: 'overview', label: 'Overview',     run: null },
    { id: 'desktop',  label: 'Desktop Run',  run: null },
    ...D.mobileRuns.map(r => ({
      id: \`m-\${r.viewport.name.replace(/\\s+/g, '-').toLowerCase()}\`,
      label: \`\${r.viewport.name}\`,
      run: r,
    })),
    ...(D.generatedCode ? [{ id: 'code', label: 'Source Code', run: null }] : []),
  ];

  const [active, setActive] = useState('overview');
  const cur = pages.find(p => p.id === active);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: C.bg }}>
      <Sidebar pages={pages} active={active} setActive={setActive} />
      <main style={{ flex: 1, overflowY: 'auto', padding: '32px', maxWidth: '960px' }}>
        {active === 'overview' && <OverviewPage />}
        {active === 'desktop'  && <StepsPage steps={D.desktopSteps} title="Desktop Run" showAI={false} />}
        {cur && cur.run && (
          <StepsPage
            steps={cur.run.steps}
            title={\`Mobile: \${cur.run.viewport.name} (\${cur.run.viewport.width}x\${cur.run.viewport.height})\`}
            showAI={true}
          />
        )}
        {active === 'code' && D.generatedCode && <CodePage />}
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>`;
}
