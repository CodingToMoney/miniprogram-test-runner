# 微信小程序自动化测试工具包

这是一个可以复制到另一台电脑使用的小程序自动化测试工具包。它会通过微信开发者工具的自动化接口打开小程序页面，执行冒烟测试和自定义流程，并生成 HTML 报告。

## 目标电脑需要先安装

- Node.js 18 或更高版本
- 微信开发者工具
- 可以正常打开的小程序项目

## 快速使用

1. 把整个 `miniprogram-test-runner` 文件夹复制到目标电脑。
2. 打开 `config.json`。
3. 修改 `projectPath` 为小程序项目的绝对路径。
4. 建议先把 `cliPath` 留空，让工具自动查找微信开发者工具 CLI。
5. macOS 双击 `run.command`，Windows 双击 `run.bat`。
6. 运行结束后打开 `reports/index.html` 查看报告。

## 命令行安装依赖

如果你不想依赖双击脚本自动安装，也可以在目标电脑命令行里进入本目录后手动安装：

macOS / Linux:

```bash
npm install $(cat requirements.txt)
```

Windows PowerShell:

```powershell
npm install (Get-Content requirements.txt)
```

也可以直接运行：

```bash
npm install
```

`package.json` 和 `requirements.txt` 里记录的是同一批 npm 依赖。

## 常见路径示例

macOS:

```json
{
  "projectPath": "/Users/yourname/projects/demo-miniprogram",
  "cliPath": "/Applications/wechatwebdevtools.app/Contents/MacOS/cli"
}
```

Windows:

```json
{
  "projectPath": "D:\\projects\\demo-miniprogram",
  "cliPath": "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat"
}
```

如果 `cliPath` 留空，工具会尝试自动识别常见安装位置。

如果自动识别失败，`cliPath` 可以填写下面任意一种：

- 真正的 CLI 文件路径，例如 macOS 的 `.../Contents/MacOS/cli`
- 微信开发者工具 `.app` 路径，例如 `/Applications/微信开发者工具.app`
- 微信开发者工具安装目录，例如 Windows 的 `C:\\Program Files (x86)\\Tencent\\微信web开发者工具`

也可以通过环境变量指定：

macOS / Linux:

```bash
export WECHAT_DEVTOOLS_CLI="/Applications/微信开发者工具.app"
npm run doctor
```

Windows PowerShell:

```powershell
$env:WECHAT_DEVTOOLS_CLI="C:\Program Files (x86)\Tencent\微信web开发者工具"
npm run doctor
```

`npm run doctor` 会打印它检查过的候选路径，方便你定位到底差在哪里。

## 跨磁盘查找微信开发者工具 CLI

如果小程序项目在一个磁盘，微信开发者工具安装在另一个磁盘，普通自动识别可能找不到。可以运行深度查找：

```bash
npm run find-cli
```

这个命令会：

- Windows: 枚举 `C:\` 到 `Z:\` 已存在的磁盘
- macOS: 扫描 `/Applications`、`~/Applications` 和 `/Volumes` 下的应用目录
- 给找到的结果自动打分，把最像微信开发者工具的路径排在第一位
- 只进入名称像微信开发者工具、WeChat、Tencent、DevTools 的目录，避免全盘无脑扫描

找到后会输出类似：

```text
Recommended CLI path:
D:\Tencent\微信web开发者工具\cli.bat
```

如果不想手动复制，直接运行：

```bash
npm run fix-cli
```

它会自动把推荐路径写入 `config.json` 的 `cliPath`。

手动填写时，Windows 路径要写成双反斜杠：

```json
{
  "cliPath": "D:\\Tencent\\微信web开发者工具\\cli.bat"
}
```

普通 `npm run doctor` 和 `npm run test` 在快速查找失败时，也会自动启用深度扫描并选择评分最高的 CLI 路径。

## Windows 找到 CLI 但启动失败

如果报告里已经出现类似：

```text
Using WeChat DevTools CLI: D:\微信web开发者工具\cli.bat
Failed to launch wechat web devTools
```

说明不是路径查找问题，而是微信开发者工具没有被自动化 SDK 成功启动。

优先检查：

- 手动打开微信开发者工具，确认它能正常启动。
- 手动打开你的小程序项目，确认项目路径没有问题。
- 在微信开发者工具里打开 `设置 -> 安全设置 -> 服务端口`。
- 关闭已经卡住的微信开发者工具进程后重新运行。
- 重新安装依赖：`npm install`。

本工具会在 Windows 上自动生成 `.runtime\wechat-devtools-cli.cmd` 包装器，避免 `.bat` 和中文路径被自动化库处理失败。包装器通过环境变量传递真实 CLI 路径，所以文件内容里不会直接写中文路径。

可以手动测试：

```powershell
.\.runtime\wechat-devtools-cli.cmd --help
```

如果这个命令都无法执行，说明微信开发者工具 CLI 本身不可用，需要先修复安装或重新安装微信开发者工具。

## 先做环境检查

也可以在命令行运行：

```bash
npm run doctor
```

它会检查：

- `projectPath` 是否存在
- `app.json` 是否存在
- 微信开发者工具 CLI 是否存在
- Node.js 版本

## 默认会测什么

默认冒烟测试会读取小程序项目的 `app.json`：

- 打开 `pages` 里的页面
- 打开 `subpackages` / `subPackages` 里的页面
- 等待页面加载
- 自动尝试处理阻挡流程的页面、弹窗和原生授权提示
- 捕获控制台错误
- 保存页面截图
- 生成报告

## 自动处理阻塞页面和弹窗

很多小程序在测试过程中会出现隐私协议、授权提示、系统提示、新人弹窗、活动弹窗等阻塞层。可以在 `blockers` 里配置自动点击步骤，让测试尽量进入后续页面；如果无法继续，也可以尝试点击关闭、跳过、取消等退出动作。

默认配置包含三类处理：

- 原生弹窗：尝试 `authorizeAllow` 和 `confirmModal`。
- 隐私协议：勾选协议并点击“同意”。
- 通用阻塞层：遇到提示、授权、网络异常、更新提醒等文本时，尝试点“我知道了/确定/允许”；遇到关闭、跳过、稍后再说等文本时，尝试退出弹窗。

```json
{
  "blockers": {
    "enabled": true,
    "maxRounds": 4,
    "actionWaitMs": 800,
    "nativeFallbacks": ["authorizeAllow", "confirmModal"],
    "rules": [
      {
        "name": "privacy-consent",
        "detectTexts": ["个人信息保护指引", "我已阅读并同意"],
        "steps": [
          { "action": "tap", "selector": "checkbox", "required": false },
          { "action": "tapText", "text": "我已阅读", "preferSelectors": ["label", "view", "text"] },
          { "action": "tapText", "text": "同意", "exact": true, "preferSelectors": ["button", "view", "text"] }
        ]
      },
      {
        "name": "generic-modal-continue",
        "detectTexts": ["温馨提示", "系统提示", "提示", "授权", "权限", "更新提醒", "新版本", "网络", "失败", "异常"],
        "steps": [
          {
            "action": "tapAnyText",
            "texts": ["我知道了", "知道了", "确定", "确认", "好的", "允许"],
            "exact": true,
            "required": false,
            "preferSelectors": ["button", "view", "text"]
          }
        ]
      }
    ]
  }
}
```

字段说明：

- `detectTexts`: 页面里出现任意一个文本时，认为这个弹窗需要处理。
- `tapText`: 按文本查找元素并点击，优先点击按钮、标签、文本等真实元素。
- `tapAnyText`: 按顺序尝试多个文案，点到第一个可用元素就停止。
- `tap`: 按选择器点击，例如 `{ "action": "tap", "selector": ".close" }`。
- `nativeFallbacks`: 尝试处理微信开发者工具暴露的原生弹窗动作。
- `maxRounds`: 最多处理几轮，适合一个弹窗关闭后又出现第二个弹窗的情况。

报告里会记录每次自动处理弹窗的动作和结果。

可以在 `config.json` 里控制：

```json
{
  "smoke": {
    "includePages": [],
    "excludePages": [],
    "maxPages": 50,
    "pageReadyTimeoutMs": 8000,
    "afterPageOpenWaitMs": 1200,
    "screenshotTimeoutMs": 10000,
    "captureScreenshots": true,
    "failOnConsoleError": true,
    "failOnRequestError": false,
    "requiredSelectors": []
  }
}
```

字段说明：

- `includePages`: 只测试指定页面。留空表示从 `app.json` 自动读取。
- `excludePages`: 排除不需要测试的页面。
- `maxPages`: 最多测试多少个页面。
- `requiredSelectors`: 每个页面都必须存在的选择器，例如 `[".page"]`。
- `screenshotTimeoutMs`: 单次截图最长等待时间，避免微信开发者工具截图接口卡住后整轮测试拖太久。
- `failOnConsoleError`: 页面打开后出现控制台错误时标记失败。
- `failOnRequestError`: 页面打开后出现 HTTP 4xx/5xx 请求时标记失败。

## 自定义业务流程

可以在 `flows` 里添加流程。默认示例是关闭状态，改成 `enabled: true` 后会执行。

```json
{
  "name": "home-basic",
  "enabled": true,
  "steps": [
    {
      "action": "reLaunch",
      "path": "/pages/index/index"
    },
    {
      "action": "tap",
      "selector": ".search-input"
    },
    {
      "action": "input",
      "selector": ".search-input",
      "text": "test"
    },
    {
      "action": "screenshot",
      "name": "home-search"
    }
  ]
}
```

支持的动作：

- `reLaunch`: 重新打开页面
- `navigateTo`: 跳转页面
- `switchTab`: 切换 tabBar
- `tap`: 点击元素
- `input`: 输入文本
- `wait`: 等待毫秒数
- `expectText`: 检查元素文本包含指定内容
- `screenshot`: 保存截图

## 报告和截图

- HTML 报告：`reports/index.html`
- JSON 报告：`reports/report-*.json`
- 截图：`screenshots/*.png`

失败时优先看 HTML 报告里的：

- 致命错误
- 环境诊断
- 控制台错误
- 请求错误
- 失败页面和截图

## 当前版本边界

这个工具包是本地可复制版 MVP，重点是页面冒烟测试和关键流程测试。

多机型 UI 检查建议作为第二阶段增强：在目标电脑能稳定跑通后，再接入基准截图对比，或接入真机/云真机平台。微信开发者工具模拟器可以帮助发现部分布局问题，但不能完全替代真实微信客户端。
