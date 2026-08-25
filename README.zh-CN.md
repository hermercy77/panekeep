# PaneKeep

简体中文 | [English](./README.md)

面向 macOS 和 Windows 上 Chrome、Edge 的本地优先浏览器工作区扩展。

> 项目正在准备首次公开发布。在发布检查清单和真实浏览器验收完成前，请只在测试用浏览器配置中加载未打包扩展。

首个版本将标签元数据保存在本地，使用浏览器原生标签组，并且只在用户明确确认后应用 AI 整理结果。

AI 设置提供常见国际及中国大陆服务商预设，同时支持自定义 OpenAI 兼容接口。Anthropic 使用原生 Messages API，其他预设使用 OpenAI Chat Completions 兼容接口。连接测试会在服务商支持时加载当前模型列表，也可以随时手动填写模型 ID。

## 开发

环境要求：Node.js 22.12 或更高版本。

```bash
npm install
npm run dev
```

在浏览器扩展管理页中，将生成的 `.output/chrome-mv3` 或 `.output/edge-mv3` 目录作为未打包扩展加载。

## 本地化

PaneKeep 当前支持简体中文（`zh-CN`）和英文（`en`）。每项新功能必须在同一次改动中补齐并测试所有支持语言；详细规则参见 [LOCALIZATION.md](./LOCALIZATION.md)。

## AI 评测

运行 `npm run eval:ai` 执行不依赖浏览器的确定性评测；也可以运行 `npm run eval:ai:live`，使用包含 20–50 个合成标签的基准测试 OpenAI 兼容服务商。详细说明参见 [AI_EVALS.md](./AI_EVALS.md)。

## 项目政策

- [隐私政策 / Privacy policy](./PRIVACY.md)
- [安全政策](./SECURITY.md)
- [贡献指南](./CONTRIBUTING.md)
- [行为准则](./CODE_OF_CONDUCT.md)

## 许可证

PaneKeep 使用 [Apache License 2.0](./LICENSE) 开源。署名信息参见 [NOTICE](./NOTICE)。
