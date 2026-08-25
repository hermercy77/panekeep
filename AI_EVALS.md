# AI organization evaluation

This suite evaluates PaneKeep without opening a browser or visiting any page. It sends only the synthetic title and URL data in `evals/ai/dataset.ts`.

## What it measures

- Purpose mode: whether tabs belonging to the same project or goal stay together.
- Type mode: whether similar content and activity types are grouped together across projects.
- Existing-workspace reuse: whether clearly matching workspaces are reused instead of duplicated.
- Safety and validity: complete coverage, no unknown or duplicate tab IDs, and resilience to a synthetic prompt-injection title.
- Speed: latency per request plus p50, p95, and maximum latency. The live suite fails when any request or p95 exceeds 10 seconds by default.

Classification quality uses pairwise precision, recall, and F1 rather than requiring specific AI-generated group names. The dataset contains 50 synthetic tabs covering software development, marketing, travel, shopping, learning, finance, renovation, community events, podcast production, unrelated personal pages, and prompt injection.

## Fast offline check

This deterministic run validates the evaluator, scoring, batching, and report format without network access:

```bash
npm run eval:ai
```

To verify wall-clock batching without an API key, simulate a 250 ms provider and split 50 tabs into five requests. With the default concurrency of three, the total should stay near two simulated request waves instead of five sequential requests:

```bash
npm run eval:ai -- \
  --sizes 50 \
  --modes purpose,type \
  --runs 3 \
  --simulated-latency-ms 250 \
  --batch-size 10 \
  --max-ms 1000
```

## Live DeepSeek evaluation

Provide the key through an environment variable. It is sent only to the configured provider and is never written to the report.

```bash
read -s PANEKEEP_AI_API_KEY
export PANEKEEP_AI_API_KEY

npm run eval:ai:live -- \
  --base-url https://api.deepseek.com/v1 \
  --model deepseek-v4-flash \
  --sizes 20,35,50 \
  --runs 3 \
  --max-ms 10000 \
  --output artifacts/ai-evals/deepseek-v4-flash.json
```

The full command makes 18 provider requests: two organization modes × three tab counts × three repetitions. For a cheaper first pass:

```bash
npm run eval:ai:live -- --sizes 20,50 --runs 1 --max-ms 10000
```

Useful options:

- `--modes purpose,type`
- `--purpose-f1 0.78`
- `--type-f1 0.72`
- `--request-timeout-ms 12000`
- `--batch-size 50`
- `--request-concurrency 3`
- `--simulated-latency-ms 250` (offline mode only)
- `--output <path>`

Exit status is non-zero when classification quality, schema validity, workspace reuse, or latency misses its threshold, so the suite can run in CI.

## Current DeepSeek baseline

On 2026-08-24, `deepseek-v4-flash` passed all 18 live cases (20, 35, and 50 tabs; purpose and type modes; three runs each): p50 3.188 seconds, p95 5.319 seconds, and maximum 5.319 seconds. Purpose-mode pairwise F1 was 95.6–100%; type-mode pairwise F1 was 78.9–100%. These figures are a point-in-time provider baseline, not a permanent performance guarantee.

## 中文说明

该评测不控制浏览器、不打开真实网页，只使用仓库中的合成标题与 URL。质量采用标签两两是否应该同组的 F1 分数，不要求 AI 输出固定分类名称；实时模式默认要求每次请求及 p95 都不超过 10 秒。没有 API Key 时，可使用 `--simulated-latency-ms` 配合 `--batch-size` 验证批次是否并行。API Key 只从环境变量读取，不会进入数据集、日志或报告。2026-08-24 的 DeepSeek 实测中，18 个用例全部通过，p50 为 3.188 秒、p95/最大值为 5.319 秒。
