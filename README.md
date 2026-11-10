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

本项目通过 [Codex GitHub Action](https://learn.chatgpt.com/docs/github-action) 对 PR 进行静态审查，并创建或更新一条中文评论。此流程不安装项目依赖、不执行构建或测试、不修改代码、不自动合并，也不是强制合并门禁。

### 启用

1. 先将 `.github/workflows/codex-review.yml` 和 `.github/codex/prompts/review.md` 合并到目标分支。工作流只读取 PR **base SHA** 中的提示词；首次引入配置的 PR 可能因 base 中尚无提示词而失败，这是预期行为。
2. 在仓库 **Settings → Secrets and variables → Actions** 新增 repository secret `OPENAI_API_KEY`，并确认对应 API 项目有可用额度。不要将密钥写入仓库。
3. 确认仓库或组织允许使用 `actions/checkout`、`openai/codex-action` 和 `actions/github-script`，且允许工作流声明评论所需的 `issues: write`、`pull-requests: write` 权限。无需为所有工作流开启默认写权限。
4. 创建同仓库、非草稿测试 PR，验证 Actions 运行和评论。之后推送新提交，确认更新原评论而非重复发布。

### 触发与结果

- 在 PR 创建、推送新提交、重新打开或从草稿转为待审查时触发；fork PR、草稿 PR 跳过。Codex Action 保留默认触发者权限限制，仅允许具备仓库写权限的协作者，不额外放行机器人或其他用户。
- 同一 PR 新运行取消旧运行。发布前重新检查 PR 是否打开、是否为草稿以及 head SHA 是否仍然匹配；已过期的报告不发布。
- 审查 job 只有仓库读取权限，使用 `read-only` sandbox 和 `drop-sudo`；评论 job 不检出 PR 代码、不接收 OpenAI Key。
- 评论带有被审查 commit 和 Actions 链接。最多输出 5 个问题；超过 12,000 字符的模型正文在发布时截断并标记。无发现不代表质量保证。
- 修改提示词的 PR 使用旧的可信提示词审查；新规则合并后才用于后续以该提交为 base 的 PR。仓库内其他指令仅作为审查数据。
- 失败时保留旧评论，其 commit 标识仍对应历史审查；请以最新 Actions 状态及评论中的 commit 判断结果。空报告会使评论 job 失败，不发布成功评论。

API 调用按 OpenAI API 使用计费，GitHub Actions 也可能消耗仓库运行额度。模型、effort 和 Codex CLI 版本使用 Action 默认值，费用和结果不保证固定；通过触发限制、并发取消及 15 分钟审查超时控制运行量。取消运行不撤销已经产生的费用。

当前使用 `actions/checkout@v5`、`openai/codex-action@v1`、`actions/github-script@v7`，未固定 commit SHA。最终报告保存到审查 runner 的临时目录并通过 job output 传递，不上传 artifact，也不长期保存临时文件。

### 排错与验收

| 现象 | 排查方式 |
| --- | --- |
| 提示可信提示词缺失或为空 | 确认 PR base commit 包含非空 `.github/codex/prompts/review.md`；不回退使用 PR 内的版本 |
| 缺少 Key、API 认证失败或额度不足 | 检查 repository secret 名称、Key 有效性与 API 额度；不要在日志中输出 Key |
| 触发者被拒绝 | 检查其仓库写权限；默认不允许机器人，勿为消除错误直接放行所有用户 |
| 没有运行或显示 skipped | 确认事件类型、同仓库 PR、非草稿状态，以及仓库 Actions 策略 |
| 评论返回 403 | 检查组织策略是否允许 job 声明的评论写权限 |
| 没有新评论但审查成功 | 检查评论 job；PR 关闭、转草稿或 head 改变时会跳过发布 |
| 空报告、API 错误或超时 | 查看失败 job；不将失败视为审查通过，已有评论不会被清空 |

上线时需用真实 PR 验证首次评论、后续更新、并发取消、草稿跳过、fork 跳过、权限拒绝、可信提示词读取和过期结果拦截。另需验证无发现、超长输出、空输出、Key 缺失/API 失败及评论权限不足场景。修改合并前的本地静态检查不代表这些远端场景已经通过。
