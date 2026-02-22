import puppeteer, { Browser, Page, HTTPRequest } from 'puppeteer';
import { existsSync } from 'fs';
import TurndownService from 'turndown';
import type { ApiCall, ConsoleEntry, StorageSnapshot } from './types';

interface ElementInfo {
  id: string;
  type: string;
  text: string;
  value?: string;
  placeholder?: string;
  name?: string;
  selector: string;
  xpath: string;
  x: number;
  y: number;
  isClickable: boolean;
  ariaLabel?: string;
  title?: string;
}

let globalBrowser: Browser | null = null;
let globalPage: Page | null = null;

// ─── Telemetry state ──────────────────────────────────────────────────────────

let stepApiCalls: ApiCall[] = [];
let stepConsoleLogs: ConsoleEntry[] = [];
const pendingRequests = new Map<HTTPRequest, { method: string; postData?: string }>();
let telemetryReady = false;

export function clearStepTelemetry(): void {
  stepApiCalls = [];
  stepConsoleLogs = [];
}

export function getStepTelemetry(): { apiCalls: ApiCall[]; consoleLogs: ConsoleEntry[] } {
  return { apiCalls: [...stepApiCalls], consoleLogs: [...stepConsoleLogs] };
}

export async function captureStorageSnapshot(): Promise<StorageSnapshot> {
  if (!globalPage) return { localStorage: {}, sessionStorage: {}, cookies: [] };
  try {
    const storage = await globalPage.evaluate(() => {
      const ls: Record<string, string> = {};
      const ss: Record<string, string> = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          ls[k] = localStorage.getItem(k) ?? '';
        }
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i)!;
          ss[k] = sessionStorage.getItem(k) ?? '';
        }
      } catch {}
      return { localStorage: ls, sessionStorage: ss };
    });
    const cookies = await globalPage.cookies();
    return {
      ...storage,
      cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain })),
    };
  } catch {
    return { localStorage: {}, sessionStorage: {}, cookies: [] };
  }
}

async function setupPageTelemetry(page: Page): Promise<void> {
  if (telemetryReady) return;
  telemetryReady = true;

  // Console log capture
  page.on('console', msg => {
    stepConsoleLogs.push({ type: msg.type(), text: msg.text() });
  });

  // Network request capture — only XHR and fetch
  await page.setRequestInterception(true);

  page.on('request', (req: HTTPRequest) => {
    const rt = req.resourceType();
    if (rt === 'xhr' || rt === 'fetch') {
      pendingRequests.set(req, { method: req.method(), postData: req.postData() || undefined });
    }
    try { req.continue(); } catch {}
  });

  page.on('response', async res => {
    const req = res.request();
    if (!pendingRequests.has(req)) return;
    const reqInfo = pendingRequests.get(req)!;
    pendingRequests.delete(req);

    let responseBody: string | undefined;
    try {
      const ct = res.headers()['content-type'] ?? '';
      if (ct.includes('json') || ct.includes('text')) {
        const text = await res.text().catch(() => '');
        responseBody = text.slice(0, 2000);
      }
    } catch {}

    stepApiCalls.push({
      url: res.url(),
      method: reqInfo.method,
      requestPayload: reqInfo.postData,
      responseStatus: res.status(),
      responseBody,
    });
  });
}

// ─── Browser detection ────────────────────────────────────────────────────────

const BROWSER_CANDIDATES = [
  // macOS
  '/Applications/Helium.app/Contents/MacOS/Helium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Arc.app/Contents/MacOS/Arc',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/snap/bin/chromium',
];

export function detectBrowser(): string | null {
  const envPath = process.env.BROWSER_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  for (const candidate of BROWSER_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function listAvailableBrowsers(): { path: string; name: string }[] {
  const found: { path: string; name: string }[] = [];
  for (const p of BROWSER_CANDIDATES) {
    if (existsSync(p)) {
      const name = p.split('/').pop()!;
      found.push({ path: p, name });
    }
  }
  return found;
}

// ─── Browser lifecycle ────────────────────────────────────────────────────────

export async function initBrowser(): Promise<void> {
  if (globalBrowser) return;

  const executablePath = detectBrowser();
  if (!executablePath) {
    throw new Error(
      'No Chromium-based browser found.\n' +
      'Run "bun src/index.ts setup" to configure one, or set BROWSER_PATH in .env'
    );
  }

  globalBrowser = await puppeteer.launch({
    headless: false,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
  });

  globalPage = await globalBrowser.newPage();
  await globalPage.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  await globalPage.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await setupPageTelemetry(globalPage);
}

export async function closeBrowser(): Promise<void> {
  if (globalBrowser) {
    await globalBrowser.close();
    globalBrowser = null;
    globalPage = null;
    telemetryReady = false;
    pendingRequests.clear();
  }
}

export function getCurrentPage(): Page | null {
  return globalPage;
}

// ─── Viewport control ─────────────────────────────────────────────────────────

export async function setViewport(width: number, height: number, isMobile: boolean = false): Promise<void> {
  if (!globalPage) return;
  await globalPage.setViewport({ width, height, isMobile, hasTouch: isMobile });
  if (isMobile) {
    await globalPage.setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
    );
  } else {
    await globalPage.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
  }
}

// ─── Screenshot ───────────────────────────────────────────────────────────────

export async function takeScreenshot(): Promise<string> {
  if (!globalPage) return '';
  try {
    const buffer = await globalPage.screenshot({ type: 'png', fullPage: false });
    return Buffer.from(buffer).toString('base64');
  } catch {
    return '';
  }
}

// ─── Markdown fetcher ─────────────────────────────────────────────────────────

async function fetchMarkdown(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; QAA/1.0)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const html = await response.text();
  return new TurndownService().turndown(html).slice(0, 5000);
}

// ─── Element extraction ───────────────────────────────────────────────────────

async function extractElements(page: Page): Promise<ElementInfo[]> {
  await new Promise(resolve => setTimeout(resolve, 1500));

  return await page.evaluate(() => {
    const results: ElementInfo[] = [];

    const isVisible = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      return rect.width > 0 && rect.height > 0;
    };

    const isInViewportOrScrollable = (el: Element): boolean => {
      const rect = el.getBoundingClientRect();
      const wh = window.innerHeight;
      const ww = window.innerWidth;
      if (rect.top >= 0 && rect.left >= 0 && rect.bottom <= wh && rect.right <= ww) return true;
      if (rect.top < wh + 1000 && rect.top > -1000) return true;
      return false;
    };

    const getXPath = (el: Element): string => {
      if (el.id) return `//*[@id="${el.id}"]`;
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let index = 0;
        let sibling = current.previousSibling;
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === current.nodeName) index++;
          sibling = sibling.previousSibling;
        }
        const tag = current.nodeName.toLowerCase();
        parts.unshift(`${tag}${index > 0 ? `[${index + 1}]` : ''}`);
        current = current.parentElement;
        if (parts.length > 10) break;
      }
      return '//' + parts.join('/');
    };

    const generateSelector = (el: HTMLElement): string => {
      if (el.id && !el.id.includes(' ')) return `#${CSS.escape(el.id)}`;
      const nameAttr = el.getAttribute('name');
      if (nameAttr) return `[name="${CSS.escape(nameAttr)}"]`;
      const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test-id');
      if (dataTestId) return `[data-testid="${CSS.escape(dataTestId)}"]`;
      if (el.tagName === 'A') {
        const href = el.getAttribute('href');
        if (href && href.length < 100) return `a[href="${CSS.escape(href)}"]`;
      }
      if (el.tagName === 'BUTTON') {
        const text = el.textContent?.trim();
        if (text && text.length < 30) return `button:has-text("${text.slice(0, 30)}")`;
        const type = el.getAttribute('type');
        if (type) return `button[type="${type}"]`;
      }
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.length < 50) return `[aria-label="${CSS.escape(ariaLabel)}"]`;
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).filter((c: string) => !c.match(/^(css-|MuiBox-|jss-)/));
        if (classes.length > 0 && classes.length <= 3)
          return `${el.tagName.toLowerCase()}${classes.slice(0, 2).map((c: string) => `.${CSS.escape(c)}`).join('')}`;
      }
      return el.tagName.toLowerCase();
    };

    const isClickable = (el: HTMLElement): boolean => {
      const tag = el.tagName.toLowerCase();
      if (['a', 'button', 'input', 'select', 'textarea'].includes(tag)) return true;
      if (el.onclick || el.hasAttribute('onclick')) return true;
      if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') return true;
      if (el.style.cursor === 'pointer') return true;
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        if (parent.onclick || parent.hasAttribute('onclick') || parent.getAttribute('role') === 'button') return true;
        parent = parent.parentElement;
        depth++;
      }
      return false;
    };

    const selectors = [
      'input:not([type="hidden"])', 'textarea', 'select', 'button', 'a[href]',
      '[role="button"]', '[role="link"]', '[role="textbox"]', '[type="submit"]',
      '[onclick]', '[data-testid]', '.btn', '.button', '[class*="Button"]', '[class*="button"]',
      'video', '[aria-label]', 'h1', 'h2', 'h3',
      '[class*="card"]', '[class*="item"]', '[class*="thumbnail"]',
    ];

    const allElements = new Set<HTMLElement>();
    selectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          if (isVisible(el) && isInViewportOrScrollable(el)) allElements.add(el as HTMLElement);
        });
      } catch (_) {}
    });

    const checkShadowDOM = (root: Document | ShadowRoot) => {
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) checkShadowDOM(el.shadowRoot);
        if (isClickable(el as HTMLElement) && isVisible(el) && isInViewportOrScrollable(el))
          allElements.add(el as HTMLElement);
      });
    };
    checkShadowDOM(document);

    let index = 0;
    const seenSelectors = new Set<string>();

    allElements.forEach(el => {
      try {
        const rect = el.getBoundingClientRect();
        const selector = generateSelector(el);
        const uniqueKey = `${selector}-${rect.x}-${rect.y}`;
        if (seenSelectors.has(uniqueKey)) return;
        seenSelectors.add(uniqueKey);

        const text = (
          el.textContent || el.getAttribute('aria-label') ||
          el.getAttribute('title') || el.getAttribute('alt') || ''
        ).trim().slice(0, 100);

        const info: ElementInfo = {
          id: `elem_${index++}`,
          type: el.tagName.toLowerCase(),
          text,
          selector,
          xpath: getXPath(el),
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
          isClickable: isClickable(el),
          ariaLabel: el.getAttribute('aria-label') || undefined,
          title: el.getAttribute('title') || undefined,
        };

        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
          info.value = inputEl.value;
          info.placeholder = (inputEl as HTMLInputElement).placeholder;
          info.name = inputEl.name;
        }

        results.push(info);
      } catch (_) {}
    });

    return results.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
  });
}

// ─── Smart click ──────────────────────────────────────────────────────────────

async function smartClick(page: Page, selector: string): Promise<void> {
  try { await page.waitForSelector(selector, { timeout: 5000 }); } catch (_) {}

  await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, selector);

  await new Promise(resolve => setTimeout(resolve, 500));

  const obscured = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return top !== el && !el.contains(top);
  }, selector);

  if (obscured) {
    await page.evaluate(() => {
      document.querySelectorAll('.overlay, .modal, .popup, [class*="overlay"], [class*="modal"], [role="dialog"]').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.position === 'fixed' || style.position === 'absolute')
          (el as HTMLElement).style.display = 'none';
      });
    });
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  try { await page.click(selector, { delay: 80 }); return; } catch (_) {}

  await page.evaluate(sel => {
    const el = document.querySelector(sel) as HTMLElement;
    if (el) el.click();
  }, selector);
}

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeTool(toolName: string, toolInput: any): Promise<string> {
  await initBrowser();

  switch (toolName) {
    case 'get_markdown':
      return fetchMarkdown(toolInput.url);

    case 'navigate_to':
      try {
        await globalPage!.goto(toolInput.url, { waitUntil: 'networkidle0', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        return `Navigated to ${toolInput.url}`;
      } catch (error: any) {
        if (error.message.includes('ERR_NAME_NOT_RESOLVED') || error.message.includes('net::ERR'))
          return `ERROR: Cannot reach ${toolInput.url}`;
        throw error;
      }

    case 'get_page_elements': {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const elements = await extractElements(globalPage!);
      if (elements.length === 0) return 'No interactive elements found.';
      const formatted = elements.slice(0, 50).map(el =>
        [
          `${el.id}: ${el.type}`,
          el.text ? `text="${el.text}"` : null,
          el.name ? `name="${el.name}"` : null,
          el.placeholder ? `placeholder="${el.placeholder}"` : null,
          el.ariaLabel ? `aria-label="${el.ariaLabel}"` : null,
          el.isClickable ? '✓clickable' : null,
          `selector="${el.selector}"`,
        ].filter(Boolean).join(', ')
      );
      return `Found ${elements.length} elements (showing first 50):\n${formatted.join('\n')}`;
    }

    case 'click_element':
      try {
        await smartClick(globalPage!, toolInput.selector);
        await new Promise(resolve => setTimeout(resolve, 1500));
        return `Clicked: ${toolInput.selector}`;
      } catch (error: any) {
        const textMatch = toolInput.selector.match(/has-text\("([^"]+)"\)/);
        if (textMatch) {
          await globalPage!.evaluate((txt: string) => {
            const el = Array.from(document.querySelectorAll('button, a, [role="button"]'))
              .find(e => e.textContent?.includes(txt)) as HTMLElement | undefined;
            if (el) el.click();
          }, textMatch[1]);
          return `Clicked element with text: ${textMatch[1]}`;
        }
        return `ERROR: Could not click "${toolInput.selector}". ${error.message}`;
      }

    case 'type_text':
      await globalPage!.waitForSelector(toolInput.selector, { timeout: 5000 });
      await globalPage!.click(toolInput.selector);
      await globalPage!.evaluate(sel => {
        const el = document.querySelector(sel) as HTMLInputElement;
        if (el) el.value = '';
      }, toolInput.selector);
      await globalPage!.type(toolInput.selector, toolInput.text, { delay: 50 });
      return `Typed "${toolInput.text}" into ${toolInput.selector}`;

    case 'press_enter':
      await globalPage!.keyboard.press('Enter');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return 'Pressed Enter';

    case 'get_page_content': {
      const text = await globalPage!.evaluate(() => document.body.innerText);
      return text.slice(0, 3000);
    }

    case 'wait_for_element':
      try {
        await globalPage!.waitForSelector(toolInput.selector, { timeout: toolInput.timeout ?? 10000 });
        return `Element ${toolInput.selector} is visible`;
      } catch (_) {
        return `Timeout waiting for ${toolInput.selector}`;
      }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
