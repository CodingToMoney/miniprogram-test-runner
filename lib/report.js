function createReport(report) {
  const title = `Mini Program Test Report - ${escapeHtml(report.runId)}`;
  const failed = report.summary.failed > 0 || report.fatalError;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #65758b;
      --line: #d8dee8;
      --pass: #16825d;
      --fail: #c23b3b;
      --skip: #7c8798;
      --info: #2764c5;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1120px, calc(100% - 32px));
      margin: 24px auto 48px;
    }
    h1, h2, h3 { margin: 0; line-height: 1.2; }
    h1 { font-size: 24px; }
    h2 { font-size: 18px; margin-bottom: 12px; }
    h3 { font-size: 15px; }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }
    .status {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 12px;
      color: #fff;
      background: ${failed ? 'var(--fail)' : 'var(--pass)'};
      font-weight: 700;
      white-space: nowrap;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(120px, 1fr));
      gap: 12px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 12px;
      background: #fbfcfe;
    }
    .metric strong {
      display: block;
      font-size: 24px;
      line-height: 1;
      margin-bottom: 6px;
    }
    .muted { color: var(--muted); }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border-bottom: 1px solid var(--line);
      padding: 10px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0;
    }
    .badge {
      display: inline-block;
      min-width: 64px;
      border-radius: 999px;
      padding: 2px 8px;
      text-align: center;
      color: #fff;
      font-weight: 700;
      font-size: 12px;
    }
    .passed { background: var(--pass); }
    .failed { background: var(--fail); }
    .skipped { background: var(--skip); }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #111827;
      color: #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      margin: 8px 0 0;
      font-size: 12px;
    }
    a { color: var(--info); }
    .list {
      margin: 0;
      padding-left: 18px;
    }
    .screenshots {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .screenshots a {
      display: inline-block;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 4px 8px;
      text-decoration: none;
      background: #fbfcfe;
    }
    @media (max-width: 720px) {
      main { width: min(100% - 20px, 1120px); margin-top: 16px; }
      .topbar { display: block; }
      .status { display: inline-block; margin-top: 12px; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      table, thead, tbody, tr, th, td { display: block; }
      thead { display: none; }
      tr { border-bottom: 1px solid var(--line); padding: 8px 0; }
      td { border: 0; padding: 4px 0; }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <div>
        <h1>微信小程序自动化测试报告</h1>
        <div class="muted">Run ID: ${escapeHtml(report.runId)}</div>
        <div class="muted">${escapeHtml(report.startedAt)} - ${escapeHtml(report.finishedAt)}</div>
      </div>
      <div class="status">${failed ? 'FAILED' : 'PASSED'}</div>
    </div>

    <section class="summary">
      ${metric('通过', report.summary.passed)}
      ${metric('失败', report.summary.failed)}
      ${metric('跳过', report.summary.skipped)}
      ${metric('耗时', `${Math.round(report.durationMs / 1000)}s`)}
    </section>

    ${report.fatalError ? errorPanel('致命错误', report.fatalError) : ''}
    ${diagnosticsPanel(report.diagnostics)}
    ${runtimeErrorsPanel('控制台错误', report.consoleErrors)}
    ${runtimeErrorsPanel('请求错误', report.requestErrors)}
    ${resultsPanel(report.results)}
  </main>
</body>
</html>`;
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(value)}</strong><span class="muted">${escapeHtml(label)}</span></div>`;
}

function diagnosticsPanel(diagnostics) {
  if (!diagnostics || diagnostics.length === 0) return '';
  return `<section class="panel">
    <h2>环境诊断</h2>
    <ul class="list">
      ${diagnostics.map((item) => `<li><strong>${escapeHtml(item.level)}</strong>: ${escapeHtml(item.message)}</li>`).join('')}
    </ul>
  </section>`;
}

function runtimeErrorsPanel(title, errors) {
  if (!errors || errors.length === 0) return '';
  return `<section class="panel">
    <h2>${escapeHtml(title)}</h2>
    <ul class="list">
      ${errors.map((item) => `<li>${escapeHtml(item.time || '')} ${escapeHtml(item.statusCode || '')} ${escapeHtml(item.url || item.message || '')}</li>`).join('')}
    </ul>
  </section>`;
}

function resultsPanel(results) {
  return `<section class="panel">
    <h2>测试结果</h2>
    <table>
      <thead>
        <tr>
          <th>状态</th>
          <th>名称</th>
          <th>页面</th>
          <th>耗时</th>
          <th>截图</th>
          <th>信息</th>
        </tr>
      </thead>
      <tbody>
        ${(results || []).map(resultRow).join('')}
      </tbody>
    </table>
  </section>`;
}

function resultRow(result) {
  return `<tr>
    <td><span class="badge ${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></td>
    <td>${escapeHtml(result.name)}</td>
    <td>${escapeHtml(result.pagePath || '')}</td>
    <td>${escapeHtml(`${result.durationMs || 0}ms`)}</td>
    <td>${screenshots(result.screenshots)}</td>
    <td>${escapeHtml(result.message || '')}${warnings(result.warnings)}${blockerActions(result.blockerActions)}${errors(result.errors)}</td>
  </tr>`;
}

function screenshots(items) {
  if (!items || items.length === 0) return '';
  return `<div class="screenshots">${items.map((item) => `<a href="../${escapeAttribute(item.path)}">${escapeHtml(item.name)}</a>`).join('')}</div>`;
}

function errors(items) {
  if (!items || items.length === 0) return '';
  return items.map((item) => `<pre>${escapeHtml(item.stack || item.message || '')}</pre>`).join('');
}

function warnings(items) {
  if (!items || items.length === 0) return '';
  return `<ul class="list">${items.map((item) => `<li>警告: ${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function blockerActions(items) {
  if (!items || items.length === 0) return '';
  return `<ul class="list">${items.map((item) => {
    const steps = (item.steps || []).map((step) => {
      const target = step.text || step.selector || '';
      const matched = step.matchedText ? ` -> ${step.selector || ''}:${step.matchedText}` : '';
      return `${step.action}${target ? `:${target}` : ''} ${step.status}${matched}${step.message ? ` (${step.message})` : ''}`;
    }).join('; ');
    return `<li>自动处理弹窗 ${escapeHtml(item.name || '')}: ${escapeHtml(item.status || '')}${steps ? ` - ${escapeHtml(steps)}` : ''}</li>`;
  }).join('')}</ul>`;
}

function errorPanel(title, error) {
  return `<section class="panel">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(error.message || '')}</p>
    ${error.hint ? `<p><strong>建议:</strong> ${escapeHtml(error.hint)}</p>` : ''}
    ${error.stack ? `<pre>${escapeHtml(error.stack)}</pre>` : ''}
  </section>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

module.exports = {
  createReport
};
