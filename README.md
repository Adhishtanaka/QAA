# QAA — Quality Assurance Agent

AI-powered browser testing that writes and replays its own test scripts. Describe tests in plain YAML; QAA uses Gemini to drive the browser on the first run, records every action, then replays them directly — no AI needed on repeat runs.

## How it works

```mermaid
flowchart LR
    A([YAML]) --> B{Cache?}
    B -- No --> C[AI Mode\nGemini drives browser]
    B -- Yes --> D[Cache Mode\nReplay actions]
    C --> E[Record & Save\nactions + screenshots]
    E --> F[Telemetry\nAPI · logs · storage]
    D --> F
    F --> G([Desktop ✓])
    G --> H[Mobile Re-runs\niPhone 12 · iPad]
    H --> I{mobile_steps\ndefined?}
    I -- Yes --> J[Full AI Run\nmobile_steps]
    I -- No --> K{Selector\nworks?}
    K -- Yes --> L[Use Cache]
    K -- No --> M[AI Fallback]
    J & L & M --> N([React HTML Report\nDesktop · Mobile · Puppeteer · Playwright])
```


## Setup

```bash
bun install
```

Copy `.env.example` to `.env` and fill in your key:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.0-flash   # optional
BROWSER_PATH=/path/to/chrome    # optional, auto-detected
```

Run the browser setup wizard:

```bash
bun src/index.ts setup
```

## Running tests

| Command | Description |
|---|---|
| `bun src/index.ts tests/example.yaml` | Single test |
| `bun src/index.ts tests/a.yaml tests/b.yaml` | Parallel tests (own browser per test) |
| `bun src/index.ts clear tests/example.yaml` | Clear cache, force fresh AI run |
| `bun src/index.ts serve github-search` | Serve latest report at `localhost:4321` |

> **Note:** Each parallel test opens its own browser instance — memory/CPU scales with test count.


## Writing tests

### Single test case

```yaml
name: "Signup Test"
steps:
  - Navigate to https://thetodaytodo.netlify.app/auth/signin
  - Click the signup button to go to the signup page
  - Create an account with a unique email and password starting with "abc"
```

### Multiple test cases (single file)

Group multiple test cases under a `tests` key — they run sequentially in one browser session and produce a **single combined report**:

```yaml
tests:
  - name: "Login Test"
    steps:
      - Navigate to https://example.com
      - Click the Login button
      - Verify the dashboard is shown

  - name: "Search Test"
    steps:
      - Navigate to https://example.com
      - Type "hello" in the search bar
      - Verify results appear
```

The report sidebar shows each test case with a green/red status dot. Click any test case to view its own Overview, Desktop, Mobile, and Source Code tabs.

Steps are plain English. Use **"verify"** or **"check"** to make a step an assertion. If a step fails (e.g. element not found), the AI responds with `FAIL: <reason>` and it's recorded in the report.

### Mobile-specific steps

```yaml
tests:
  - name: "Signup Test"
    mobile_steps:
      - Tap the hamburger menu
      - Tap Sign Up
      - Fill in email and password
    steps:
      - Click the signup button
      - Fill in email and password
```

When `mobile_steps` is present, all mobile viewport runs use full AI with those steps. When absent, mobile falls back to the hybrid cached-then-AI approach.

## Generated scripts

After a successful run, the HTML report embeds two ready-to-run test scripts viewable under the **Source Code** tab — switch between frameworks with the Puppeteer / Playwright toggle:

| Framework | API style |
|---|---|
| **Puppeteer** | `page.type()`, `page.setViewport()`, `puppeteer.launch()` |
| **Playwright** | `page.fill()`, `browser.newContext({ ...devices['iPhone 12'] })`, `chromium.launch()` |

Both scripts cover desktop + iPhone 12 + iPad and can be downloaded directly from the report.
