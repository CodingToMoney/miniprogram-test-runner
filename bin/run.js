#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const WebSocket = require('ws');
const { findBestCliPath, findCliPaths, getCliPathCandidates, loadConfig, readMiniProgramPages } = require('../lib/config');
const { ensureDir, nowStamp, writeJson } = require('../lib/fs-extra');
const { createReport } = require('../lib/report');
const { runSmokeTests, runFlows } = require('../lib/runner');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.json');
const reportsDir = path.join(rootDir, 'reports');
const screenshotsDir = path.join(rootDir, 'screenshots');
const runtimeDir = path.join(rootDir, '.runtime');

async function main() {
  ensureDir(reportsDir);
  ensureDir(screenshotsDir);
  ensureDir(runtimeDir);

  const startedAt = new Date();
  const isDoctor = process.argv.includes('--doctor');
  const isFindCli = process.argv.includes('--find-cli');
  const shouldWriteConfig = process.argv.includes('--write-config');
  const config = loadConfig(configPath);

  if (isFindCli) {
    runFindCli(shouldWriteConfig);
    return;
  }

  const diagnostics = diagnose(config);

  if (isDoctor) {
    printDiagnostics(diagnostics);
    process.exit(diagnostics.some((item) => item.level === 'error') ? 1 : 0);
  }

  if (diagnostics.some((item) => item.level === 'error')) {
    printDiagnostics(diagnostics);
    writeFailureReport({
      startedAt,
      diagnostics,
      message: 'Configuration check failed.'
    });
    process.exit(1);
  }

  const automator = require('miniprogram-automator');
  const runId = nowStamp();
  const context = {
    rootDir,
    reportsDir,
    screenshotsDir,
    runId,
    config,
    diagnostics,
    consoleErrors: [],
    requestErrors: []
  };

  let miniProgram;
  const results = [];
  let fatalError = null;

  try {
    console.log('Launching WeChat DevTools automation...');
    miniProgram = await launchMiniProgram(automator, config, diagnostics);
    console.log('Connected to WeChat DevTools automation.');

    hookRuntimeEvents(miniProgram, context);
    context.miniProgram = miniProgram;

    const pages = readMiniProgramPages(config.projectPath, config.smoke || {});
    console.log(`Discovered ${pages.length} page(s) for smoke testing.`);
    results.push(...await runSmokeTests(miniProgram, pages, context));
    results.push(...await runFlows(miniProgram, context));
  } catch (error) {
    fatalError = normalizeError(error);
    console.error('\nFatal error:', fatalError.message);
  } finally {
    if (miniProgram) {
      try {
        await withTimeout(miniProgram.close(), 5000, 'Timed out closing mini program automation.');
      } catch (error) {
        context.diagnostics.push({
          level: 'warn',
          message: `Failed to close mini program automation cleanly: ${error.message}`
        });
      }
    }
  }

  const finishedAt = new Date();
  const summary = summarize(results, fatalError);
  const report = {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
    summary,
    diagnostics: context.diagnostics,
    consoleErrors: context.consoleErrors,
    requestErrors: context.requestErrors,
    results,
    fatalError
  };

  writeJson(path.join(reportsDir, `report-${runId}.json`), report);
  fs.writeFileSync(path.join(reportsDir, 'index.html'), createReport(report), 'utf8');

  console.log('\nReport written to:', path.join(reportsDir, 'index.html'));
  console.log(`Summary: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped.`);

  process.exit(summary.failed > 0 || fatalError ? 1 : 0);
}

async function launchMiniProgram(automator, config, diagnostics) {
  if (config.manualCliLaunch !== false) {
    const autoPort = config.autoPort || 9420;
    const wsEndpoint = `ws://127.0.0.1:${autoPort}`;
    console.log(`Probing automation WebSocket: ${wsEndpoint}`);
    if (await isAutomationReady(wsEndpoint, 3000)) {
      console.log('Automation WebSocket is ready, skipping CLI auto.');
      diagnostics.push({
        level: 'info',
        message: `Automation WebSocket is already ready: ${wsEndpoint}`
      });
    } else {
      console.log('Automation WebSocket is not ready, running CLI auto.');
      startAutomationWithCli(config, diagnostics, autoPort);
    }
    console.log(`Connecting to automation WebSocket: ${wsEndpoint}`);
    return connectWithRetry(automator, wsEndpoint, config.launchTimeoutMs || 120000);
  }

  return automator.launch({
    projectPath: config.projectPath,
    cliPath: config.resolvedCliPath,
    timeout: config.launchTimeoutMs || 120000,
    trustProject: config.trustProject !== false
  });
}

async function connectWithRetry(automator, wsEndpoint, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await withTimeout(
        automator.connect({ wsEndpoint }),
        5000,
        `Timed out connecting to ${wsEndpoint}`
      );
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }

  throw lastError || new Error(`Failed connecting to ${wsEndpoint}`);
}

function isAutomationReady(wsEndpoint, timeoutMs) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsEndpoint);
    const timer = setTimeout(() => finish(false), timeoutMs);

    function finish(value) {
      clearTimeout(timer);
      try {
        ws.close();
      } catch (error) {
        // Ignore close errors during readiness probing.
      }
      resolve(value);
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({ id: 'probe', method: 'Tool.getInfo', params: {} }));
    });
    ws.on('message', () => finish(true));
    ws.on('error', () => finish(false));
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startAutomationWithCli(config, diagnostics, autoPort) {
  const cliPort = config.cliServicePort || 9421;
  const args = [
    'auto',
    '--project',
    config.projectPath,
    '--auto-port',
    String(autoPort),
    '--port',
    String(cliPort)
  ];

  if (config.trustProject !== false) {
    args.push('--trust-project');
  }

  let result = runCliCommand(config.resolvedCliPath, args, config.cliAutoTimeoutMs || 45000);
  if (result.status !== 0 && /must be restarted|already started at port/i.test(`${result.stdout}\n${result.stderr}`)) {
    diagnostics.push({
      level: 'warn',
      message: `IDE service port conflict, running cli quit then retrying auto. ${clipOutput(result.stdout || result.stderr)}`
    });
    runCliCommand(config.resolvedCliPath, ['quit'], 30000);
    result = runCliCommand(config.resolvedCliPath, args, config.cliAutoTimeoutMs || 45000);
  }

  diagnostics.push({
    level: result.status === 0 ? 'info' : 'error',
    message: `CLI auto exit code: ${result.status}. ${clipOutput(result.stdout || result.stderr)}`
  });

  if (result.error) {
    throw new Error(`Failed to run WeChat DevTools CLI auto: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Failed to start WeChat DevTools automation. ${clipOutput(result.stdout || result.stderr)}`);
  }
}

function runCliCommand(cliPath, args, timeout) {
  return spawnSync(cliPath, args, {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
    timeout
  });
}

function runFindCli(shouldWriteConfig) {
  console.log('\nSearching for WeChat DevTools CLI. This can take a minute on large disks...\n');
  const result = findCliPaths();

  console.log(`Scanned roots: ${result.roots.join(' | ') || 'none'}`);
  console.log(`Visited directories: ${result.visited}${result.truncated ? ' (truncated)' : ''}`);

  if (!result.found.length) {
    console.log('\nNo CLI file found.');
    console.log('You can still set WECHAT_DEVTOOLS_CLI or cliPath manually if the tool is installed in a custom location.');
    process.exit(1);
  }

  const best = result.found[0];
  console.log('\nRecommended CLI path:');
  console.log(best.path);

  if (result.found.length > 1) {
    console.log('\nOther possible CLI path(s):');
    for (const item of result.found.slice(1)) {
      console.log(`- ${item.path}`);
    }
  }

  if (shouldWriteConfig) {
    updateConfigCliPath(best.path);
    console.log('\nconfig.json has been updated automatically.');
  } else {
    console.log('\nTo write this path into config.json automatically, run: npm run fix-cli');
  }
  process.exit(0);
}

function diagnose(config) {
  const diagnostics = [];

  if (!config.projectPath) {
    diagnostics.push({
      level: 'error',
      message: 'config.json is missing projectPath. Set it to your mini program project directory.'
    });
  } else if (!fs.existsSync(config.projectPath)) {
    diagnostics.push({
      level: 'error',
      message: `projectPath does not exist: ${config.projectPath}`
    });
  } else if (!fs.existsSync(path.join(config.projectPath, 'app.json'))) {
    diagnostics.push({
      level: 'error',
      message: `app.json was not found under projectPath: ${config.projectPath}`
    });
  }

  const cliResult = findBestCliPath(config.cliPath);
  const resolvedCliPath = cliResult.path;
  config.realCliPath = resolvedCliPath;
  config.resolvedCliPath = prepareCliPathForLaunch(resolvedCliPath, diagnostics);
  const cliCandidates = getCliPathCandidates(config.cliPath);

  if (!resolvedCliPath) {
    diagnostics.push({
      level: 'error',
      message: 'WeChat DevTools CLI was not found. Leave cliPath empty for auto-detect, or set it to the real cli/cli.bat file.'
    });
    diagnostics.push({
      level: 'info',
      message: `Checked CLI candidates: ${cliCandidates.length ? cliCandidates.join(' | ') : 'none'}`
    });
    if (cliResult.search) {
      diagnostics.push({
        level: 'info',
        message: `Deep scan roots: ${cliResult.search.roots.join(' | ') || 'none'}`
      });
      diagnostics.push({
        level: 'info',
        message: `Deep scan visited directories: ${cliResult.search.visited}${cliResult.search.truncated ? ' (truncated)' : ''}`
      });
    }
  } else if (!fs.existsSync(resolvedCliPath)) {
    diagnostics.push({
      level: 'error',
      message: `cliPath does not exist: ${resolvedCliPath}`
    });
  } else {
    diagnostics.push({
      level: 'info',
      message: `Using WeChat DevTools CLI: ${resolvedCliPath}${cliResult.source === 'deep-scan' ? ' (auto-selected by deep scan)' : ''}`
    });
    if (config.resolvedCliPath !== resolvedCliPath) {
      diagnostics.push({
        level: 'info',
        message: `Using launch wrapper for Windows: ${config.resolvedCliPath}`
      });
    }
    diagnostics.push(createCliExecutionDiagnostic(config.resolvedCliPath));
  }

  diagnostics.push({
    level: 'info',
    message: `Node.js version: ${process.version}`
  });

  return diagnostics;
}

function prepareCliPathForLaunch(cliPath, diagnostics) {
  if (!cliPath || process.platform !== 'win32' || !/\.bat$/i.test(cliPath)) {
    return cliPath;
  }

  process.env.WECHAT_DEVTOOLS_REAL_CLI = cliPath;
  const wrapperPath = path.join(runtimeDir, 'wechat-devtools-cli.cmd');
  const content = [
    '@echo off',
    'setlocal',
    'if "%WECHAT_DEVTOOLS_REAL_CLI%"=="" (',
    '  echo WECHAT_DEVTOOLS_REAL_CLI is not set.',
    '  exit /b 1',
    ')',
    'call "%WECHAT_DEVTOOLS_REAL_CLI%" %*',
    'exit /b %errorlevel%',
    ''
  ].join('\r\n');

  fs.writeFileSync(wrapperPath, content, 'utf8');
  diagnostics.push({
    level: 'info',
    message: `Created Windows CLI wrapper: ${wrapperPath}`
  });
  return wrapperPath;
}

function createCliExecutionDiagnostic(cliPath) {
  if (!cliPath) {
    return {
      level: 'warn',
      message: 'Skipped CLI execution check because cliPath is empty.'
    };
  }

  const result = spawnSync(cliPath, ['--help'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
    timeout: 8000
  });

  if (result.error) {
    return {
      level: 'warn',
      message: `CLI execution check failed: ${result.error.message}`
    };
  }

  return {
    level: result.status === 0 ? 'info' : 'warn',
    message: `CLI execution check exit code: ${result.status}. ${clipOutput(result.stdout || result.stderr)}`
  };
}

function clipOutput(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? `Output: ${text.slice(0, 300)}` : 'No output.'
}

function updateConfigCliPath(cliPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  config.cliPath = cliPath;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function hookRuntimeEvents(miniProgram, context) {
  if (typeof miniProgram.on !== 'function') return;

  miniProgram.on('console', (message) => {
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    if (/error|fail|exception/i.test(text)) {
      context.consoleErrors.push({
        time: new Date().toISOString(),
        message: text
      });
    }
  });

  miniProgram.on('request', (request) => {
    const statusCode = request && (request.statusCode || request.status);
    if (statusCode >= 400) {
      context.requestErrors.push({
        time: new Date().toISOString(),
        url: request.url || '',
        statusCode
      });
    }
  });
}

function summarize(results, fatalError) {
  const summary = { passed: 0, failed: fatalError ? 1 : 0, skipped: 0, total: results.length };
  for (const result of results) {
    if (result.status === 'passed') summary.passed += 1;
    if (result.status === 'failed') summary.failed += 1;
    if (result.status === 'skipped') summary.skipped += 1;
  }
  return summary;
}

function normalizeError(error) {
  const message = error && error.message ? error.message : String(error);
  return {
    message,
    hint: getLaunchHint(message),
    stack: error && error.stack ? error.stack : ''
  };
}

function getLaunchHint(message) {
  if (!/launch|devtools|cliPath|wechat/i.test(message)) return '';
  return [
    'Windows 上请先确认微信开发者工具能手动打开该小程序项目。',
    '在微信开发者工具里打开 设置/安全设置/服务端口。',
    '如果安装目录是中文路径，当前版本会自动创建 .runtime/wechat-devtools-cli.cmd 包装器。',
    '如果仍失败，请在命令行运行 .runtime\\wechat-devtools-cli.cmd --help 看是否能正常执行。'
  ].join(' ');
}

function printDiagnostics(diagnostics) {
  console.log('\nMini Program Test Runner Doctor\n');
  for (const item of diagnostics) {
    const label = item.level.toUpperCase().padEnd(5);
    console.log(`[${label}] ${item.message}`);
  }
  console.log('');
}

function writeFailureReport({ startedAt, diagnostics, message }) {
  const report = {
    runId: nowStamp(),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    summary: { passed: 0, failed: 1, skipped: 0, total: 0 },
    diagnostics,
    consoleErrors: [],
    requestErrors: [],
    results: [],
    fatalError: { message, stack: '' }
  };

  fs.writeFileSync(path.join(reportsDir, 'index.html'), createReport(report), 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
