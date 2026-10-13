const fs = require('fs');
const os = require('os');
const path = require('path');

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (config.projectPath) {
    config.projectPath = path.resolve(cleanInputPath(config.projectPath));
  }
  if (config.cliPath) {
    config.cliPath = cleanInputPath(config.cliPath);
  }

  return config;
}

function resolveCliPath(cliPath) {
  const candidates = getCliPathCandidates(cliPath);
  const scored = scoreCliPaths(candidates.filter(isUsableCliPath));
  return scored.length ? scored[0].path : '';
}

function findCliPaths(options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 8;
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 120000;
  const roots = options.roots && options.roots.length
    ? options.roots.map(cleanInputPath)
    : getDeepScanRoots();
  const found = [];
  let visited = 0;

  for (const root of roots) {
    scan(root, 0);
  }

  return {
    found: scoreCliPaths(Array.from(new Set(found.map((item) => path.normalize(item))))),
    roots,
    visited,
    truncated: visited >= maxEntries
  };

  function scan(dir, depth) {
    if (visited >= maxEntries || depth > maxDepth || !dir) return;

    let stat;
    try {
      stat = fs.statSync(dir);
    } catch (error) {
      return;
    }

    if (stat.isFile()) {
      if (isCliFile(dir)) found.push(dir);
      return;
    }

    if (!stat.isDirectory()) return;

    visited += 1;

    const directCandidates = process.platform === 'win32'
      ? [path.join(dir, 'cli.bat'), path.join(dir, 'cli.exe')]
      : [path.join(dir, 'Contents', 'MacOS', 'cli'), path.join(dir, 'cli')];

    for (const candidate of directCandidates) {
      if (isUsableCliPath(candidate)) found.push(candidate);
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!shouldScanDirectory(entry.name, depth)) continue;
      scan(path.join(dir, entry.name), depth + 1);
    }
  }
}

function getCliPathCandidates(cliPath) {
  const candidates = [];

  if (process.env.WECHAT_DEVTOOLS_CLI) {
    addCliCandidates(candidates, process.env.WECHAT_DEVTOOLS_CLI);
  }

  if (cliPath) {
    addCliCandidates(candidates, cliPath);
  }

  for (const candidate of getDefaultCliCandidates()) {
    addCliCandidates(candidates, candidate);
  }

  return Array.from(new Set(candidates.map((candidate) => path.normalize(candidate))));
}

function findBestCliPath(cliPath, options = {}) {
  const quick = resolveCliPath(cliPath);
  if (quick) {
    return {
      path: quick,
      source: 'quick',
      search: null
    };
  }

  const search = findCliPaths(options);
  return {
    path: search.found.length ? search.found[0].path : '',
    source: search.found.length ? 'deep-scan' : 'not-found',
    search
  };
}

function addCliCandidates(candidates, inputPath) {
  if (!inputPath) return;

  const value = cleanInputPath(inputPath);
  candidates.push(value);

  if (process.platform === 'darwin') {
    candidates.push(path.join(value, 'Contents', 'MacOS', 'cli'));
    candidates.push(path.join(value, 'Contents', 'Resources', 'app.nw', 'bin', 'cli'));

    if (value.endsWith('/Contents/MacOS')) {
      candidates.push(path.join(value, 'cli'));
    }
  }

  if (process.platform === 'win32') {
    candidates.push(path.join(value, 'cli.bat'));
    candidates.push(path.join(value, 'cli.exe'));
    candidates.push(path.join(value, '微信web开发者工具', 'cli.bat'));
    candidates.push(path.join(value, '微信开发者工具', 'cli.bat'));
  }
}

function getDefaultCliCandidates() {
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.APPDATA,
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)'
    ].filter(Boolean);

    const appNames = [
      'Tencent\\微信web开发者工具',
      'Tencent\\微信开发者工具',
      '微信web开发者工具',
      '微信开发者工具',
      'wechatwebdevtools'
    ];

    return roots.flatMap((root) => appNames.map((name) => path.join(root, name, 'cli.bat')));
  }

  if (process.platform === 'darwin') {
    const homeApplications = path.join(os.homedir(), 'Applications');
    return [
      '/Applications/wechatwebdevtools.app',
      '/Applications/WeChat DevTools.app',
      '/Applications/微信开发者工具.app',
      '/Applications/微信web开发者工具.app',
      path.join(homeApplications, 'wechatwebdevtools.app'),
      path.join(homeApplications, 'WeChat DevTools.app'),
      path.join(homeApplications, '微信开发者工具.app'),
      path.join(homeApplications, '微信web开发者工具.app')
    ];
  }

  return [];
}

function getDeepScanRoots() {
  if (process.platform === 'win32') {
    const roots = [];
    for (let code = 67; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(root)) roots.push(root);
    }
    return roots;
  }

  if (process.platform === 'darwin') {
    const roots = [
      '/Applications',
      path.join(os.homedir(), 'Applications')
    ];

    const volumesDir = '/Volumes';
    try {
      for (const volume of fs.readdirSync(volumesDir)) {
        roots.push(path.join(volumesDir, volume, 'Applications'));
        roots.push(path.join(volumesDir, volume));
      }
    } catch (error) {
      // Ignore inaccessible /Volumes on locked-down machines.
    }

    return roots.filter((root) => fs.existsSync(root));
  }

  return ['/opt', '/usr/local', path.join(os.homedir(), '.local')].filter((root) => fs.existsSync(root));
}

function shouldScanDirectory(name, depth) {
  const lower = name.toLowerCase();
  if (name.startsWith('.') && depth > 0) return false;
  if (['node_modules', '$recycle.bin', 'system volume information', 'windows', 'programdata', 'library', 'users'].includes(lower)) return false;
  if (depth === 0) return true;
  if (process.platform === 'win32' && /^[a-z]:\\?$/i.test(name)) return true;
  return /微信|wechat|tencent|devtool|developer|program|application|app|tool|software|soft|wx|小程序/i.test(name);
}

function readMiniProgramPages(projectPath, smokeConfig) {
  const appJsonPath = path.join(projectPath, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const pages = new Set();

  for (const page of appJson.pages || []) {
    pages.add(normalizePagePath(page));
  }

  for (const pkg of appJson.subpackages || appJson.subPackages || []) {
    const root = trimSlashes(pkg.root || '');
    for (const page of pkg.pages || []) {
      pages.add(normalizePagePath(`${root}/${page}`));
    }
  }

  let list = Array.from(pages);
  const include = (smokeConfig.includePages || []).map(normalizePagePath);
  const exclude = new Set((smokeConfig.excludePages || []).map(normalizePagePath));

  if (include.length > 0) {
    list = list.filter((page) => include.includes(page));
  }

  list = list.filter((page) => !exclude.has(page));

  if (smokeConfig.maxPages && smokeConfig.maxPages > 0) {
    list = list.slice(0, smokeConfig.maxPages);
  }

  return list;
}

function normalizePagePath(pagePath) {
  return `/${trimSlashes(pagePath)}`;
}

function trimSlashes(value) {
  return String(value).replace(/^\/+|\/+$/g, '');
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function cleanInputPath(value) {
  return expandHome(String(value).trim().replace(/^['"]|['"]$/g, ''));
}

function isUsableCliPath(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch (error) {
    return false;
  }
}

function isCliFile(candidate) {
  const basename = path.basename(candidate).toLowerCase();
  return process.platform === 'win32'
    ? basename === 'cli.bat' || basename === 'cli.exe'
    : basename === 'cli';
}

function scoreCliPaths(paths) {
  return paths
    .map((candidate) => ({ path: candidate, score: scoreCliPath(candidate) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.path.length - right.path.length;
    });
}

function scoreCliPath(candidate) {
  const value = candidate.replace(/\\/g, '/');
  const lower = value.toLowerCase();
  const context = getCliProductContext(value);
  const contextLower = context.toLowerCase();
  let score = 0;

  if (!isUsableCliPath(candidate)) return 0;
  if (lower.includes('node_modules')) return 0;
  if (lower.includes('/.git/')) return 0;
  if (/\/cli(\.bat|\.exe)?$/i.test(value)) score += 10;
  if (contextLower.includes('wechatwebdevtools')) score += 80;
  if (context.includes('微信开发者工具')) score += 80;
  if (context.includes('微信web开发者工具')) score += 80;
  if (contextLower.includes('tencent')) score += 25;
  if (contextLower.includes('devtools') || contextLower.includes('developer')) score += 25;
  if (lower.includes('.app/contents/macos/cli')) score += 50;
  if (lower.startsWith('/applications/')) score += 45;
  else if (lower.includes('/applications/')) score += 10;
  if (lower.startsWith('/volumes/') && lower.includes(' stable ')) score -= 15;
  if (/program files/i.test(candidate)) score += 10;

  return score;
}

function getCliProductContext(normalizedPath) {
  const parts = normalizedPath.split('/').filter(Boolean);
  const appIndex = parts.findIndex((part) => part.toLowerCase().endsWith('.app'));
  if (appIndex >= 0) {
    return parts[appIndex];
  }

  const cliIndex = parts.findIndex((part) => /^cli(\.bat|\.exe)?$/i.test(part));
  if (cliIndex >= 0) {
    return parts.slice(Math.max(0, cliIndex - 4), cliIndex).join('/');
  }

  return parts.slice(-4).join('/');
}

module.exports = {
  findCliPaths,
  findBestCliPath,
  getCliPathCandidates,
  loadConfig,
  resolveCliPath,
  readMiniProgramPages
};
