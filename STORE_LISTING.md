# Chrome Web Store listing — PaneKeep

This file is the source of truth for the first Chrome Web Store submission. Keep the dashboard fields, packaged behavior, in-product disclosures, and [PRIVACY.md](./PRIVACY.md) consistent.

## Shared product details

- Name: `PaneKeep`
- Category: `Productivity`
- Homepage: `https://github.com/hermercy77/panekeep`
- Support: `https://github.com/hermercy77/panekeep/issues`
- Privacy policy: `https://github.com/hermercy77/panekeep/blob/main/PRIVACY.md`
- License: `Apache-2.0`

## 简体中文商店文案

### 摘要

用浏览器原生标签组把打开的标签整理成本地工作区，可选 AI 仅在你主动确认时生成预览。

### 详细说明

PaneKeep 把当前打开的标签整理成清晰、可编辑的本地工作区，并与 Chrome 原生标签组保持同步。

主要功能：

- 按窗口、工作区、未分类、固定标签和特殊页面查看标签；
- 搜索、筛选、批量选择和拖动多个标签；
- 创建、编辑、排序和合并工作区；
- 导出和导入包含窗口、工作区与标签元数据的 JSON 备份；
- 可选 AI 整理：选择标签、生成预览、手动调整，再确认应用；
- 支持简体中文和英文界面。

隐私边界：

- 工作区与标签元数据默认只保存在浏览器本地；
- 不使用开发者遥测、广告或分析服务器；
- 只有你主动测试 AI 连接或生成整理预览时，数据才会直接发送到你选择的 AI 服务商；
- AI 整理发送所选标签的标题、网址和域名，以及现有工作区的名称、描述和标签；
- 不发送 Cookie、密码、表单数据或网页正文；
- AI 生成的变更必须先经过预览和用户确认。

## English store copy

### Summary

Organize open tabs into local workspaces with native tab groups and optional, user-initiated AI previews.

### Detailed description

PaneKeep organizes currently open tabs into clear, editable local workspaces that stay aligned with Chrome's native tab groups.

Key features:

- Browse tabs by window, workspace, unclassified, pinned, and special-page state;
- Search, filter, multi-select, and drag multiple tabs;
- Create, edit, reorder, and merge workspaces;
- Export and import JSON backups containing window, workspace, and tab metadata;
- Optional AI organization: select tabs, generate a preview, adjust assignments, and confirm before applying;
- Simplified Chinese and English interfaces.

Privacy boundaries:

- Workspace and tab metadata stays in local browser storage by default;
- No developer-operated telemetry, advertising, or analytics server;
- Data is sent only when you deliberately test an AI connection or generate an organization preview, directly to the AI provider you select;
- AI organization sends selected tab titles, URLs, and domains plus existing workspace names, descriptions, and tags;
- Cookies, passwords, form data, and page contents are not sent;
- AI-generated changes always require a preview and user confirmation.

## Privacy practices

### Single purpose

PaneKeep helps users organize currently open browser tabs into local workspaces backed by Chrome's native tab groups, with optional user-initiated AI categorization that produces a preview before any browser changes are applied.

### Permission justifications

| Permission | Dashboard justification |
|---|---|
| `tabs` | Reads the title, URL, pinned state, active state, order, window, and group of open tabs so the extension can display and organize them. It also moves, groups, activates, and optionally closes tabs only in response to workspace actions. |
| `tabGroups` | Reads and updates Chrome native tab-group titles, colors, order, and membership so each PaneKeep workspace maps to a native tab group. |
| `storage` | Stores the selected interface language and optional AI configuration in local extension storage. The API key is never stored in sync storage. |
| `sidePanel` | Provides PaneKeep's primary workspace interface in Chrome's side panel. |
| Optional host access | Requested at runtime only for the exact AI host configured by the user. It is used for a user-initiated model-list test and organization request. Public hosts must use HTTPS; HTTP is limited to `localhost` and `127.0.0.1`. |

### Remote code

Select **No, I am not using remote code**.

All executable logic ships inside the extension package. AI responses are treated as untrusted data, validated against a strict schema, and never evaluated or executed as code.

### Data disclosures to review in the dashboard

Declare the categories that correspond to the dashboard's current wording, including:

- Web browsing activity: open-tab URLs, titles, window/group membership, and recent activation metadata;
- Authentication information: the user-provided AI API key stored locally and sent only to the selected provider;
- User-generated content: workspace names, descriptions, and tags;
- Website content only if the dashboard classifies page titles as website content. PaneKeep does not read or send page bodies, form data, cookies, or passwords.

Certify that data is not sold, used for advertising, used for creditworthiness, or transferred for purposes unrelated to the extension's single purpose.

## Graphic assets

- Package icons: `public/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
- Editable icon master: `store-assets/panekeep-master.svg`
- Store icon: upload `public/icons/icon-128.png`
- English small promo tile: `store-assets/promo-small-en.png`
- Simplified Chinese small promo tile: `store-assets/promo-small-zh-CN.png`
- Simplified Chinese screenshot: `store-assets/screenshots/zh-CN-workspaces.png`
- English screenshot: `store-assets/screenshots/en-ai-settings.png`
- Both screenshots are 1280×800 PNG, full bleed, and generated from the isolated native-Chromium acceptance flow

## Reviewer notes

- PaneKeep does not operate a backend and does not receive user browsing data or AI requests.
- The optional AI feature is bring-your-own-key and sends requests directly from the extension to the provider selected by the user.
- The extension asks for the configured AI origin only at runtime and only during an explicit connection test or organization request.
- The organization dialog discloses the metadata being sent before the request.
- Every proposed AI organization is validated, shown as a preview, and applied only after explicit confirmation.
- The extension does not load or execute remote code.
