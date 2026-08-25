# Privacy Policy / 隐私政策

Effective date: 2026-08-25

生效日期：2026-08-25

## 中文

### 简要说明

Tab Fridge 是一款本地优先的浏览器标签工作区扩展。开发者不运营用于接收标签数据、AI 请求或使用分析数据的服务器。除非你主动使用 AI 功能，否则标签与工作区数据不会离开你的浏览器。

### 本地处理和保存的数据

扩展为了显示、整理、恢复浏览器标签和原生标签组，会在浏览器本地处理并保存：

- 标签标题、网址、站点图标网址、固定/活动状态、顺序和最近活动时间；
- 浏览器窗口、原生标签组及其关联标识；
- 你创建或编辑的工作区名称、描述、标签、颜色和图标；
- 界面语言；
- 你选择的 AI 服务商、Base URL、模型名称和 API Key。

工作区与标签元数据保存在扩展的 IndexedDB 中。AI 配置和 API Key 保存在 `chrome.storage.local`，不会通过 Chrome 同步功能同步。开发者无法读取这些本地数据。

### 可选 AI 功能

AI 功能默认由用户配置，并且只在你主动测试连接或生成整理预览时调用：

- 测试连接会把 API Key 发送给你选择的 AI 服务商，并请求其模型列表；
- 生成整理预览会把所选标签的标题、网址和域名，以及现有工作区的名称、描述和标签发送给你选择的 AI 服务商；
- 不会发送 Cookie、密码、表单数据或网页正文；
- API Key 会作为认证信息随请求直接发送给所选服务商；
- 开发者不代理、接收或保存这些请求。

当前可选择的第三方服务包括 OpenAI、Anthropic、Google Gemini、DeepSeek、OpenRouter、Groq、Mistral AI、xAI、Together AI、Fireworks AI、阿里云百炼、SiliconFlow、火山方舟、Moonshot AI、智谱 AI、MiniMax、百度千帆和腾讯混元。你也可以配置自定义的 OpenAI 兼容端点。相应服务商会依据其自己的条款和隐私政策处理数据；选择自定义端点时，你需要自行确认该端点的运营者与数据处理方式。

公网 AI 端点必须使用 HTTPS。HTTP 仅允许访问本机的 `localhost` 或 `127.0.0.1` 地址。扩展只在需要时请求你所配置 AI 主机的可选访问权限。

### 备份

你可以主动导出 JSON 备份。备份包含窗口、工作区和标签元数据，包括标签标题和网址，但不包含 API Key、Cookie、密码或网页正文。备份文件由你自行保存和管理，不会上传给开发者。

### 收集、共享和出售

- 开发者不收集遥测、崩溃报告、广告标识符或使用分析数据；
- 开发者不出售用户数据；
- 开发者不使用用户数据投放广告、评估信用或训练模型；
- 除你主动选择的 AI 服务商或自定义端点外，扩展不会把用户数据传给第三方；
- 开发者不会允许人员查看你的标签或工作区数据。

### 保留与删除

本地数据会保留在浏览器的扩展存储中，直到你删除相应工作区、清除或覆盖 AI 配置，或卸载扩展。你可以随时删除自己导出的备份文件。卸载前如需保留工作区，请先导出备份。

### Chrome Web Store Limited Use

本扩展对从 Chrome 扩展 API 获得的信息的使用遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。数据仅用于提供或改进用户可见的标签工作区和可选 AI 整理功能。

### 联系方式与政策更新

隐私问题可以通过 [GitHub Issues](https://github.com/hermercy77/tab-fridge/issues) 联系开发者。安全漏洞请不要公开提交 Issue，请按照 [SECURITY.md](./SECURITY.md) 私下报告。

如果数据处理方式发生变化，本政策、商店隐私申报和扩展内提示会在变化生效前同步更新。

---

## English

### Summary

Tab Fridge is a local-first browser tab workspace extension. The developer does not operate a server that receives tab data, AI requests, telemetry, or usage analytics. Tab and workspace data does not leave your browser unless you deliberately use an AI feature.

### Data processed and stored locally

To display, organize, and restore browser tabs and native tab groups, the extension processes and stores locally:

- Tab titles, URLs, favicon URLs, pinned and active state, order, and recent activity time;
- Browser window, native tab-group, and related identifiers;
- Workspace names, descriptions, tags, colors, and icons that you create or edit;
- Interface language;
- Your selected AI provider, Base URL, model name, and API key.

Workspace and tab metadata is stored in the extension's IndexedDB database. AI configuration and the API key are stored in `chrome.storage.local` and are not synchronized through Chrome Sync. The developer cannot access this local data.

### Optional AI features

AI is configured by the user and is contacted only when you deliberately test a connection or generate an organization preview:

- A connection test sends the API key to the selected AI provider and requests its model list;
- Generating an organization preview sends selected tab titles, URLs, and domains plus existing workspace names, descriptions, and tags to the selected AI provider;
- Cookies, passwords, form data, and page contents are not sent;
- The API key is sent directly to the selected provider as request authentication;
- The developer does not proxy, receive, or store these requests.

Selectable third-party services currently include OpenAI, Anthropic, Google Gemini, DeepSeek, OpenRouter, Groq, Mistral AI, xAI, Together AI, Fireworks AI, Alibaba Cloud Model Studio, SiliconFlow, Volcengine Ark, Moonshot AI, Zhipu AI, MiniMax, Baidu Qianfan, and Tencent Hunyuan. You may also configure a custom OpenAI-compatible endpoint. The selected service processes data under its own terms and privacy policy. For a custom endpoint, you are responsible for identifying its operator and data practices.

Public AI endpoints must use HTTPS. Plain HTTP is permitted only for `localhost` or `127.0.0.1` on the same device. The extension requests optional access only to the AI host that you configure and only when needed.

### Backups

You may deliberately export a JSON backup. It contains window, workspace, and tab metadata, including tab titles and URLs. It does not contain the API key, cookies, passwords, or page contents. You control the exported file; it is not uploaded to the developer.

### Collection, sharing, and sale

- The developer does not collect telemetry, crash reports, advertising identifiers, or usage analytics;
- The developer does not sell user data;
- The developer does not use user data for advertising, credit decisions, or model training;
- The extension does not transfer user data to a third party other than the AI provider or custom endpoint that you deliberately select;
- The developer does not permit humans to read your tab or workspace data.

### Retention and deletion

Local data remains in browser extension storage until you delete the relevant workspace, clear or replace AI configuration, or uninstall the extension. You can delete exported backup files at any time. Export a backup before uninstalling if you want to preserve your workspaces.

### Chrome Web Store Limited Use

The use of information received from Chrome extension APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide or improve the user-visible tab workspace and optional AI organization features.

### Contact and changes

For privacy questions, contact the developer through [GitHub Issues](https://github.com/hermercy77/tab-fridge/issues). Do not disclose security vulnerabilities in a public issue; follow [SECURITY.md](./SECURITY.md) for private reporting.

If data handling changes, this policy, the store privacy disclosures, and in-product notices will be updated before the change takes effect.
