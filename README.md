# miniprogram-test-runner

A self-contained smoke test runner for WeChat Mini Programs. It drives the WeChat DevTools automation interface over WebSocket, walks every page in the target miniprogram, runs an optional flow, and writes an HTML report with screenshots and console errors.

I built it so the same folder can be copied onto any teammate's machine and work without setup beyond `npm install` and pointing `config.json` at a real miniprogram project.

## What it does

- Launches WeChat DevTools in automation mode and connects via WebSocket
- Discovers every page in `app.json` and opens each one
- Captures a screenshot per page and records any console / network errors
- Runs an optional flow from `config.json` (e.g. login → search)
- Writes a self-contained HTML report to `reports/index.html`
- Has a `--doctor` mode that checks config + CLI path before you run anything
- Has a `--find-cli` mode that hunts the WeChat DevTools CLI across drives when the project lives on a different disk from the IDE

## Requirements

- Node.js 18 or newer
- WeChat DevTools (微信开发者工具) installed
- A miniprogram project that opens cleanly in DevTools

## Quick start

1. Copy this folder to the target machine.
2. Edit `config.json` and set `projectPath` to the absolute path of the miniprogram you want to test. Leave `cliPath` empty to let the runner auto-detect.
3. macOS: double-click `run.command`. Windows: double-click `run.bat`.
4. Open `reports/index.html` when the run finishes.

You can also run it manually:

```bash
npm install
npm test
```

## Useful scripts

```bash
npm run doctor      # verify config + WeChat DevTools CLI can be found
npm run find-cli    # search every mounted drive for the CLI; useful when the project and IDE are on different disks
npm run fix-cli     # same as find-cli, but writes the best match back into config.json
```

If `cliPath` is empty, the runner tries these in order:

- The value of `WECHAT_DEVTOOLS_CLI` env var, if set
- Common install locations on macOS and Windows
- A recursive search that respects `maxDepth` and `maxEntries` in `config.json`

The runner accepts the following values for `cliPath`:

- The real CLI executable, e.g. `/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
- The `.app` bundle, e.g. `/Applications/微信开发者工具.app`
- The install root on Windows, e.g. `C:\Program Files (x86)\Tencent\微信web开发者工具`

## Configuration

`config.example.json` is a working template. The fields that matter most:

```jsonc
{
  "projectPath": "/absolute/path/to/your/miniprogram",
  "cliPath": "",                     // leave empty to auto-detect
  "appId": "your-wx-appid",
  "trustProject": true,              // auto-accept the "trust this project" prompt
  "smoke": {
    "maxPages": 50,                  // safety cap
    "captureScreenshots": true,
    "failOnConsoleError": true
  },
  "flows": [
    {
      "name": "search-demo",
      "enabled": false,
      "steps": [
        { "action": "reLaunch", "path": "/pages/index/index" },
        { "action": "tap",     "selector": ".search-input" },
        { "action": "input",   "selector": ".search-input", "text": "test" }
      ]
    }
  ]
}
```

There is also a `blockers` section that auto-dismisses common modals (privacy consent, generic "got it" popups, etc.) before each page opens. It's enabled by default and lives entirely inside `config.json` — no source changes needed.

## Project layout

```
.
├── bin/run.js          # entry point, ties everything together
├── lib/
│   ├── config.js       # config loading, CLI discovery
│   ├── runner.js       # smoke + flow execution
│   ├── report.js       # HTML report builder
│   └── fs-extra.js     # small fs helpers
├── reports/            # generated, gitignored
├── screenshots/        # generated, gitignored
├── config.json         # your local config (gitignored)
├── config.example.json
├── run.command         # macOS launcher
├── run.bat             # Windows launcher
└── requirements.txt    # npm dependencies, one per line
```

## Notes

- `reports/`, `screenshots/`, `node_modules/` and `.runtime/` are all gitignored.
- `config.json` is gitignored because it contains absolute paths. Commit `config.example.json` instead.
- The runner is single-process and writes one report per run. There is no built-in CI integration, but `npm test` exits non-zero on failure, so any CI that reads exit codes will work.
