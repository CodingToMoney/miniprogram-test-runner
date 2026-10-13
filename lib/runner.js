const path = require('path');

async function runSmokeTests(miniProgram, pages, context) {
  const results = [];

  if (!pages.length) {
    return [{
      name: 'smoke:pages',
      type: 'smoke',
      status: 'skipped',
      message: 'No pages found in app.json.',
      durationMs: 0,
      screenshots: []
    }];
  }

  for (const pagePath of pages) {
    const startedAt = Date.now();
    const result = {
      name: `smoke:${pagePath}`,
      type: 'smoke',
      pagePath,
      status: 'passed',
      message: '',
      durationMs: 0,
      screenshots: [],
      errors: []
    };

    try {
      console.log(`[OPEN] ${pagePath}`);
      const beforeConsoleErrorCount = context.consoleErrors.length;
      const beforeRequestErrorCount = context.requestErrors.length;
      const page = await openPage(miniProgram, pagePath, context.config.smoke.pageReadyTimeoutMs);
      if (page.__openWarning) {
        result.warnings = result.warnings || [];
        result.warnings.push(page.__openWarning);
      }

      await wait(context.config.smoke.afterPageOpenWaitMs || 1000);
      await handleBlockers(page, context, result);
      await assertRequiredSelectors(page, context.config.smoke.requiredSelectors || []);

      let screenshotError = null;
      if (context.config.smoke.captureScreenshots !== false) {
        try {
          const screenshot = await captureScreenshot(page, context, `smoke-${slug(pagePath)}`);
          if (screenshot) result.screenshots.push(screenshot);
        } catch (error) {
          screenshotError = error;
          addResultError(result, error);
        }
      }

      if (context.config.smoke.failOnConsoleError && context.consoleErrors.length > beforeConsoleErrorCount) {
        const newErrors = context.consoleErrors.slice(beforeConsoleErrorCount);
        throw new Error(`Console error detected after opening page: ${summarizeMessage(newErrors[0].message)}`);
      }

      if (context.config.smoke.failOnRequestError && context.requestErrors.length > beforeRequestErrorCount) {
        const newErrors = context.requestErrors.slice(beforeRequestErrorCount);
        throw new Error(`Request error detected after opening page: ${summarizeMessage(newErrors[0].url || newErrors[0].statusCode)}`);
      }

      if (screenshotError) {
        throw screenshotError;
      }
    } catch (error) {
      result.status = 'failed';
      result.message = error.message || String(error);
      addResultError(result, error);
    } finally {
      result.durationMs = Date.now() - startedAt;
      results.push(result);
      console.log(`${statusMark(result.status)} ${result.name} (${result.durationMs}ms)`);
    }
  }

  return results;
}

async function runFlows(miniProgram, context) {
  const flows = context.config.flows || [];
  const results = [];

  for (const flow of flows) {
    if (!flow.enabled) {
      results.push({
        name: `flow:${flow.name}`,
        type: 'flow',
        status: 'skipped',
        message: 'Flow is disabled.',
        durationMs: 0,
        screenshots: []
      });
      continue;
    }

    const startedAt = Date.now();
    const result = {
      name: `flow:${flow.name}`,
      type: 'flow',
      status: 'passed',
      message: '',
      durationMs: 0,
      screenshots: [],
      errors: []
    };

    let currentPage = null;

    try {
      for (const step of flow.steps || []) {
        currentPage = await runStep(miniProgram, currentPage, step, context, result);
      }
    } catch (error) {
      result.status = 'failed';
      result.message = error.message || String(error);
      result.errors.push({
        message: result.message,
        stack: error.stack || ''
      });
    } finally {
      result.durationMs = Date.now() - startedAt;
      results.push(result);
      console.log(`${statusMark(result.status)} ${result.name} (${result.durationMs}ms)`);
    }
  }

  return results;
}

async function runStep(miniProgram, currentPage, step, context, result) {
  switch (step.action) {
    case 'reLaunch':
      currentPage = await openPage(miniProgram, step.path, step.timeoutMs || context.config.smoke.pageReadyTimeoutMs);
      await handleBlockers(currentPage, context, result);
      return currentPage;
    case 'navigateTo':
      await miniProgram.navigateTo(step.path);
      currentPage = await miniProgram.currentPage();
      await handleBlockers(currentPage, context, result);
      return currentPage;
    case 'switchTab':
      await miniProgram.switchTab(step.path);
      currentPage = await miniProgram.currentPage();
      await handleBlockers(currentPage, context, result);
      return currentPage;
    case 'tap':
      await requireElement(currentPage, step.selector).then((element) => element.tap());
      return currentPage;
    case 'input':
      await requireElement(currentPage, step.selector).then((element) => element.input(step.text || ''));
      return currentPage;
    case 'wait':
      await wait(step.ms || 1000);
      return currentPage;
    case 'handleBlockers':
      currentPage = currentPage || await miniProgram.currentPage();
      await handleBlockers(currentPage, context, result);
      return currentPage;
    case 'expectText':
      await expectText(currentPage, step.selector, step.text || '');
      return currentPage;
    case 'screenshot': {
      const screenshot = await captureScreenshot(currentPage, context, step.name || result.name);
      if (screenshot) result.screenshots.push(screenshot);
      return currentPage;
    }
    default:
      throw new Error(`Unsupported flow action: ${step.action}`);
  }
}

async function openPage(miniProgram, pagePath, timeoutMs) {
  let page;
  try {
    page = await withTimeout(
      miniProgram.reLaunch(pagePath),
      timeoutMs || 8000,
      `Timed out opening page: ${pagePath}`
    );
  } catch (error) {
    const currentPage = await getCurrentPageSafely(miniProgram);
    if (!currentPage) throw error;
    currentPage.__openWarning = `${error.message || String(error)}; continued with current page: ${currentPage.path || 'unknown'}`;
    page = currentPage;
  }

  if (page && typeof page.waitFor === 'function') {
    await page.waitFor(Math.min(timeoutMs || 8000, 8000));
  }
  return page;
}

async function getCurrentPageSafely(miniProgram) {
  try {
    return await withTimeout(
      miniProgram.currentPage(),
      5000,
      'Timed out reading current page after route timeout.'
    );
  } catch (error) {
    return null;
  }
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

async function assertRequiredSelectors(page, selectors) {
  for (const selector of selectors) {
    await requireElement(page, selector);
  }
}

async function requireElement(page, selector) {
  if (!page) throw new Error('No active page.');
  if (!selector) throw new Error('Missing selector.');
  const element = await page.$(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);
  return element;
}

async function expectText(page, selector, expectedText) {
  const element = await requireElement(page, selector);
  const actual = typeof element.text === 'function'
    ? await element.text()
    : typeof element.wxml === 'function'
      ? await element.wxml()
      : '';

  if (!String(actual).includes(expectedText)) {
    throw new Error(`Expected ${selector} to contain "${expectedText}", got "${actual}".`);
  }
}

async function captureScreenshot(page, context, name) {
  const target = page && typeof page.screenshot === 'function'
    ? page
    : context.miniProgram && typeof context.miniProgram.screenshot === 'function'
      ? context.miniProgram
      : null;
  if (!target) return null;

  const relativePath = path.join('screenshots', `${context.runId}-${slug(name)}.png`);
  const absolutePath = path.join(context.rootDir, relativePath);
  await withTimeout(
    target.screenshot({ path: absolutePath }),
    context.config.smoke.screenshotTimeoutMs || 10000,
    `Timed out capturing screenshot: ${name}`
  );

  return {
    name,
    path: relativePath.replace(/\\/g, '/')
  };
}

async function handleBlockers(page, context, result) {
  const config = context.config.blockers || {};
  if (config.enabled === false || !page) return;

  const rules = Array.isArray(config.rules) ? config.rules : [];
  if (!rules.length && !Array.isArray(config.nativeFallbacks)) return;

  await runNativeFallbacks(context, config, result);

  const maxRounds = config.maxRounds || 1;
  for (let round = 0; round < maxRounds; round += 1) {
    let handledInRound = false;

    for (const rule of rules) {
      const detected = await detectBlocker(page, rule);
      if (!detected) continue;

      const actionRecord = {
        name: rule.name || 'blocker',
        round: round + 1,
        status: 'handled',
        steps: []
      };

      for (const step of rule.steps || []) {
        const stepRecord = await runBlockerStep(page, step, context);
        actionRecord.steps.push(stepRecord);
        if (stepRecord.status === 'failed' && step.required !== false) {
          actionRecord.status = 'partial';
          break;
        }
        if (config.actionWaitMs !== 0) {
          await wait(config.actionWaitMs || 500);
        }
      }

      result.blockerActions = result.blockerActions || [];
      result.blockerActions.push(actionRecord);
      handledInRound = true;
      await wait(config.actionWaitMs || 500);
    }

    if (!handledInRound) break;
  }
}

async function detectBlocker(page, rule) {
  const detectTexts = rule.detectTexts || [];
  if (!detectTexts.length) return true;

  for (const text of detectTexts) {
    const element = await findElementByText(page, text, { exact: false });
    if (element) return true;
  }
  return false;
}

async function runNativeFallbacks(context, config, result) {
  const methods = Array.isArray(config.nativeFallbacks) ? config.nativeFallbacks : [];
  if (!methods.length || !context.miniProgram || typeof context.miniProgram.native !== 'function') return;

  const actionRecord = {
    name: 'native-fallbacks',
    round: 0,
    status: 'handled',
    steps: []
  };

  const native = context.miniProgram.native();
  for (const method of methods) {
    const record = {
      action: 'native',
      text: method,
      selector: '',
      status: 'passed',
      message: ''
    };

    try {
      if (!native || typeof native[method] !== 'function') {
        throw new Error(`Unsupported native method: ${method}`);
      }
      await withTimeout(native[method](), 1500, `Timed out running native method: ${method}`);
    } catch (error) {
      record.status = 'failed';
      record.message = error.message || String(error);
    }

    actionRecord.steps.push(record);
    if (config.actionWaitMs !== 0) {
      await wait(config.actionWaitMs || 500);
    }
  }

  if (actionRecord.steps.some((step) => step.status === 'passed')) {
    result.blockerActions = result.blockerActions || [];
    result.blockerActions.push(actionRecord);
  }
}

async function runBlockerStep(page, step, context) {
  const record = {
    action: step.action,
    text: step.text || (Array.isArray(step.texts) ? step.texts.join('|') : ''),
    selector: step.selector || '',
    status: 'passed',
    message: ''
  };

  try {
    if (step.action === 'tap') {
      const element = await requireElement(page, step.selector);
      await element.tap();
      return record;
    }

    if (step.action === 'tapText') {
      const candidate = await findElementByText(page, step.text, {
        exact: !!step.exact,
        preferExact: step.preferExact !== false,
        preferSelectors: step.preferSelectors || []
      });
      if (!candidate) throw new Error(`Text not found: ${step.text}`);
      record.selector = candidate.selector;
      record.matchedText = candidate.text.slice(0, 120);
      await candidate.element.tap();
      return record;
    }

    if (step.action === 'tapAnyText') {
      const texts = Array.isArray(step.texts) ? step.texts : [];
      const failures = [];
      for (const text of texts) {
        const candidate = await findElementByText(page, text, {
          exact: !!step.exact,
          preferExact: step.preferExact !== false,
          preferSelectors: step.preferSelectors || []
        });
        if (!candidate) {
          failures.push(`Text not found: ${text}`);
          continue;
        }
        record.text = text;
        record.selector = candidate.selector;
        record.matchedText = candidate.text.slice(0, 120);
        await candidate.element.tap();
        return record;
      }
      throw new Error(failures.join('; ') || 'No text candidates configured.');
    }

    if (step.action === 'native') {
      if (!context.miniProgram || typeof context.miniProgram.native !== 'function') {
        throw new Error('Native automation is not available.');
      }
      const native = context.miniProgram.native();
      if (!native || typeof native[step.method] !== 'function') {
        throw new Error(`Unsupported native method: ${step.method}`);
      }
      await native[step.method]();
      return record;
    }

    if (step.action === 'wait') {
      await wait(step.ms || 500);
      return record;
    }

    throw new Error(`Unsupported blocker action: ${step.action}`);
  } catch (error) {
    record.status = 'failed';
    record.message = error.message || String(error);
    return record;
  }
}

async function findElementByText(page, text, options = {}) {
  if (!text) return null;

  const selectors = [
    'button',
    'label',
    'checkbox',
    'text',
    'view'
  ];
  const candidates = [];

  for (const selector of selectors) {
    let elements = [];
    try {
      elements = await page.$$(selector);
    } catch (error) {
      elements = [];
    }

    for (const element of elements) {
      const value = await getElementSearchText(element);
      if (!matchesText(value, text, options.exact)) continue;
      candidates.push({
        element,
        selector,
        text: value
      });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const exactA = normalizeText(a.text) === normalizeText(text) ? 0 : 1;
    const exactB = normalizeText(b.text) === normalizeText(text) ? 0 : 1;
    if (options.preferExact !== false && exactA !== exactB) return exactA - exactB;
    const preferenceA = selectorPreference(a.selector, options.preferSelectors);
    const preferenceB = selectorPreference(b.selector, options.preferSelectors);
    if (preferenceA !== preferenceB) return preferenceA - preferenceB;
    if (a.text.length !== b.text.length) return a.text.length - b.text.length;
    const selectorA = selectorScore(a.selector);
    const selectorB = selectorScore(b.selector);
    if (selectorA !== selectorB) return selectorA - selectorB;
    return 0;
  });

  return candidates[0];
}

async function getElementSearchText(element) {
  const parts = [];
  try {
    if (typeof element.text === 'function') {
      parts.push(await element.text());
    }
  } catch (error) {
    // Some elements do not expose innerText in the DevTools automation bridge.
  }

  try {
    if (typeof element.outerWxml === 'function') {
      parts.push(stripTags(await element.outerWxml()));
    }
  } catch (error) {
    // WXML is a fallback only.
  }

  return normalizeText(parts.join(' '));
}

function matchesText(value, expected, exact) {
  const actual = normalizeText(value);
  const target = normalizeText(expected);
  if (!actual || !target) return false;
  return exact ? actual === target : actual.includes(target);
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ');
}

function selectorScore(selector) {
  return {
    button: 0,
    label: 1,
    checkbox: 2,
    text: 3,
    view: 4
  }[selector] || 10;
}

function selectorPreference(selector, preferSelectors) {
  const list = Array.isArray(preferSelectors) ? preferSelectors : [];
  const index = list.indexOf(selector);
  return index >= 0 ? index : list.length + 1;
}

function addResultError(result, error) {
  const message = error && error.message ? error.message : String(error);
  if (result.errors.some((item) => item.message === message)) return;
  result.errors.push({
    message,
    stack: error && error.stack ? error.stack : ''
  });
}

function summarizeMessage(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text || '').replace(/\s+/g, ' ').slice(0, 220);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return String(value)
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';
}

function statusMark(status) {
  if (status === 'passed') return '[PASS]';
  if (status === 'failed') return '[FAIL]';
  return '[SKIP]';
}

module.exports = {
  runSmokeTests,
  runFlows
};
