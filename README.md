# Nuxt Minimal Starter

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Codex PR 自动审查

正式工作流为 `.github/workflows/codex-review.yml`，包含 `execute`、`review`、`comment` 三个 job，负责真实静态审查、独立证据校验及中文评论发布。不安装项目依赖、不运行应用、构建或测试、不修改代码、不自动合并；工作流本身不配置强制合并门禁。无发现不代表代码没有缺陷。

### 启用与触发

1. 将正式工作流与 `.agents/skills/code-review/` 合并到目标分支。准备、校验和发布工具均取自 PR 的固定 base SHA；修改技能的 PR 仍使用 base 中的可信版本，新版本合并后用于后续 PR。
2. 在仓库 Actions secrets 配置 `OPENAI_API_KEY`，确认所配置服务有可用额度，并允许工作流使用固定版本的 Actions 和显式权限。
3. 同仓库、非草稿 PR 在创建、推送新提交、重新打开、转为待审查时运行。fork 和草稿 PR 跳过；触发者仍受 Codex Action 的权限限制。

当前配置固定 Codex CLI `0.167.1`、模型 `gpt-6.1-sol`、effort `low`，Responses endpoint 为 `https://gptapi001.huasu.org/v1/responses`。第三方 Actions 均固定到 commit SHA。调用会消耗 API 及 GitHub Actions 额度。

### 正式审查与证据

- 在干净的固定 head 上，通过 base 导出的原始 helper 预构建快照。审查排除 ignored 路径、`*.md`、`docs/**`、`.docs/**`、`*.test.mjs`；无可审查文本时不调用模型。
- Standards 与 architect、devops、product_contract、runtime_performance、security 共六个独立 worker，各自读取同一 manifest 和全部完整 patch，继承模型及 effort，使用独立上下文。主会话核查候选、合并重复，不代审规则。
- 可信配置要求六个 worker 名额（不含主会话），连续提交六路后等待，不要求六路同时运行。独立校验器核对真实容量、请求与返回、身份、材料摘要、模型配置及终态；任一必要任务或证据不完整，不能认定审查完成。
- 单任务预算为 10 分钟，整场预算为 30 分钟，最多再留 30 秒收尾。Codex Action 步骤超时 33 分钟，execute job 超时 40 分钟，review 与 comment job 各 5 分钟。
- execute 仅有仓库读取权限，使用 `review-temp` 权限配置和 `drop-sudo`：审查工作区只读，指定 runtime-tmp 可写。运行时能力查询保留为正式准备步骤，不执行模拟能力演练。review 有仓库与 Actions 读取权限；comment 有仓库读取及评论写入权限，不接收 OpenAI Key。
- 原始事件经白名单投影与脱敏，执行证据和机器结果分别上传为 `codex-review-evidence-<run>-<attempt>`、`codex-review-result-<run>-<attempt>`，保留 7 天。未公开任意 rollout 日志、提示词或环境内容。

### 评论与并发

同一 PR 新的 execute 运行会取消旧 execute；评论发布串行执行。发布前核对结果身份，并重新检查 PR 仍打开、非草稿且 head 未变化，避免发布过期报告或覆盖更新结果。

评论展示 Standards、五条 AI 规则、核实问题及摘要，并标明 base/head、run/attempt 和 Actions 链接。不设置“最多五个问题”的限制。超过评论预算时展示问题索引，完整详情分段写入 review job 的在线 Summary；详细内容无法交付时明确报错。失败或证据不足时按可用证据报告未完成，不作为“未发现问题”。

模拟评论展示验收、独立能力探测演练及旧分批工具已移除，不再作为日常或手动工作流。正式链路的单元测试保留，可本地执行：

```powershell
$reviewTests = Get-ChildItem .agents/skills/code-review/scripts/*.test.mjs | ForEach-Object FullName
node --test $reviewTests
```

### 排错与验收

| 现象 | 排查方式 |
| --- | --- |
| 可信准备失败 | 确认固定 base 包含完整技能及 helper，固定 head 干净，快照材料校验通过 |
| Key 缺失或 API 错误 | 检查 secret 名称、服务认证与额度，不输出密钥 |
| 检查 skipped | 确认是否同仓库、非草稿，以及事件与触发者权限是否满足条件 |
| 审查未完成 | 查看 evidence/result artifact 的 reasons、worker 终态、读取摘要与调度诊断，不以模型自述替代证据 |
| 评论失败或未更新 | 检查 comment job 权限、结果身份、PR 当前 head 与在线详情交付状态 |

本地测试不能替代真实远端验收。工作流变更后，用真实 PR 验证执行、证据校验与评论更新；跳过、取消、权限失败及过期拦截等场景，只有实际验证后才能记录通过。
