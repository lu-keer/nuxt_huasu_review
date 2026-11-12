# GitHub Actions 调用 code-review skill

## 目标与配置

正式工作流调用 `.agents/skills/code-review/`，skill 是规则、过滤、六路分工、候选核查及报告标准的唯一来源。原 helper 和规则正文不迁移、不复制到 `.github/`。

能力依据为 [42973379962](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42973379962)，结论“需最小适配后接入”：可信准备步骤预构建材料；源码、工具和快照只读；仅专用临时目录可写。不实现多进程执行器。

- CLI/proxy：`0.167.1`；Codex Action：`1d82a3dba7c7988ec71ecae1ed5b8e8db96495c5`。
- 模型：`gpt-6.1-sol`，effort `low`；endpoint：`https://gptapi001.huasu.org/v1/responses`。
- `drop-sudo`；`review-temp` 继承 `:read-only`，仅本次 `runtime-tmp` 可写。
- 配置仓库 secret `OPENAI_API_KEY`；密钥仅交给 Codex Action，不上传认证或原始会话日志。
- 不安装项目依赖，不运行项目构建、测试或 PR 提供的脚本。

“与本地一致”指相同提交范围、规则版本和模型配置下，材料、规则执行和报告标准一致，不承诺模型逐字输出相同。

## 调用与信任边界

`pull_request` 的 opened、synchronize、reopened、ready_for_review 自动触发，同仓库、非草稿执行。fork 与草稿跳过；不设置 paths 过滤。文档和 `*.test.mjs` 过滤统一由 helper 决定。

1. `execute`（40 分钟、contents:read）：检出事件 head SHA，导出事件 base SHA 的完整 skill，缺失即失败。skill 内 `ci-review.mjs prepare` 检查干净 HEAD、提交、路径与四层材料，使用原 helper 的 `base...HEAD` 语义预构建，记录 merge-base 和摘要。
2. 从仓库外 controller 调用一次 Codex Action，显式读取可信 SKILL 与 context。PR checkout 作为只读数据；不加载 head 配置作为调度指令。六路各自读取规则和同一完整材料，独立上下文、继承模型，容量不足排队。保留 10 分钟单任务、30 分钟整场及 30 秒收尾预算。
3. Codex 后只运行固定基础设施封存及上传步骤，不执行仓库脚本。observer 仅投影白名单宿主证据，排除继承历史，不上传 raw rollout。
4. `review`（5 分钟、contents:read）：独立下载 artifact，调用 base 的可信校验器，关联真实六路身份、材料、模型和终态；交付版本化 result.json；评论超长时交付 Job Summary。保留检查名 review。
5. `comment`（5 分钟、仅此 job 有评论写权限）：调用 base 中 publisher。artifact 只作为数据，发布前重新检查 PR 仍开放、非草稿且 head 一致；相同 head 的旧 run/attempt 不覆盖新报告。

CI context/result schema、可信提示词及全部适配模块均位于 skill 内。原本地调用方式继续有效；CI 禁止再次构建或回退材料。材料归调用方持有；终态未知时保留目录和任务身份，由 runner 生命周期回收。

## 检查与报告策略

### 严格调度验收（evidenceVersion=2）

正式审查与能力验证共用 `ci-scheduling.mjs`，不再以任意两路区间重叠作为通过依据。可信 context/config 固定 `schedulingPolicy=required`；缺失、降级或调度结果为 FAIL/UNVERIFIED 时，review 未完成且失败，仍保留已核实 findings。零可审查文本不启动模型，调度为 NOT_APPLICABLE。

可信准备显式配置 `agents.max_concurrent_threads_per_session=6`（不含主会话），并在模型调用前由固定 CLI `0.167.1` 的 app-server `config/read` 查询有效容量及子任务默认配置。该查询不创建模型 turn，不携带 API key；只保存白名单容量、版本与配置摘要。接口或有效配置未验证时准备失败，不调用模型。配置语义来源：[官方 multi-agent 文档](https://developers.openai.com/codex/multi-agent/)，固定 CLI 另用 strict-config 与真实 config/read 验证，不以最新版文档代替版本验证。

观察器保存同一父会话的 spawn 请求/返回、任务身份、原始时间/记录顺序、等待/状态查询、fork_turns 与 model/effort 覆盖标记、子会话实际配置。继续过滤继承历史、认证、prompt 和任意输出。校验器核查六路完整身份链，有名额且提交已返回时必须继续提交，满额才等待；快速自然完成和阻塞 spawn 不直接判违规。容量、返回、顺序或实际配置不完整时 UNVERIFIED，不估算宿主耗时。

独立能力验证额外执行六个快速控制任务和六个有界保持任务，名称与规则任务隔离；保持 helper 固定 20 秒，每任务预算 30 秒、整组 5 分钟。控制演练验证实际并发及容量调度，不能代替六路审查；控制证据缺失不解锁完整演练。

发布限制：实现 PR 自身使用旧 base 的可信适配器，其检查不能作为新门槛验收。先在实现分支通过严格能力验证，再合入实现；之后从新 base 创建普通变更、零文本和受控证据缺失的验收 PR。严格能力未通过不得发布，不升级 CLI、不提供宽松模式。旧 PR #9 报告不重写。

本地验证与实际云端结果见后续“严格调度修正验收记录”；本地测试不代表云端通过。

严格实现已由 PR #10 合入 main（`26561b8`），固定六名额。发布前能力和完整演练通过；main 新 base 的普通代码、零文本、受控缺证据三路径也已完成，白名单证据、artifact 与实际评论均已核对，见下述记录。最新真实 PR 三路径验收及运行证据见 [严格调度验收记录](ci-strict-scheduling-validation.md)；历史两名额失败记录不作为现行六名额配置结论。

### 严格调度修正前置验收记录（2026-11-12）

- 本地四组针对性测试（ci-runtime-contract、ci-scheduling、ci-review、ci-capability）54 项通过；`actionlint -shellcheck=` 与 `git diff --check` 通过。真实固定 CLI 的无模型 config/read 也确认有效 worker 容量为 2；未恢复本地自动审查。
- 首轮固定提交 `86e8fbc`：[43002409934](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43002409934)。工作流执行成功不等于能力通过：严格调度 FAIL、控制演练 FAIL，完整演练 skipped。已下载并核对 capability-report 和 capability-probe，未合入默认分支。
- 该轮 config/read 确认两个名额，六路 spawn 的实际请求/返回间隔为 23–29ms，宿主原生提交非阻塞；六路实际最大并发数为 2。例如 Standards 的父会话完成事件在 10:18:56.706 UTC、记录顺序 46，父会话随后在 10:18:58.404 UTC、顺序 47 调用 list_agents，而不是提交 pending devops。相同机制还发生于 devops 完成后。该轮可明确归因为父会话收到终态后未立即补位，不把这些结果追溯当作 PR #9 默认容量或根因的证据，也不把请求/返回间隔冒充 worker 执行时长。
- 控制演练暴露两个独立问题：fixture AGENTS 自动发现干扰部分控制任务输出；部分保持任务在 helper 未退出时提前最终答复。修正为与正式流程一致的仓库外 controller 和 project_doc_max_bytes=0，控制消息显式说明不可信数据边界、等待真实退出码；未放宽 NO_FINDINGS、30 秒单任务或 5 分钟整组约束。判定器同时限定控制组自身的提交区间，避免把前一组的等待误计为本组违规。
- 新版固定提交 `decfd9e`：[43004106125](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43004106125)：probe 六路严格调度及快速/保持控制组均 PASS，最大实际并发分别为 1/2。prepared 在模型启动前因命名权限配置缺少默认选择而预检失败，未执行完整演练。已为无模型 config/read 查询显式选择只读默认权限，未改变 Action 权限配置；新版已复验，见下项。通过前不得合入；新 base PR 验收尚未执行。

- 最新固定提交 `c3f09dc`：[43005960058](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43005960058)。容量预检与控制组 PASS，但规则调度再次 FAIL（WAIT_WITH_AVAILABLE_CAPACITY），完整演练 skipped。保持草稿、不合入；完整原因和 artifact 说明见 [严格调度验收记录](ci-strict-scheduling-validation.md)。

- 全部必要任务、核查与报告完成时 review 成功，包括有 findings。
- 零可审查文本时不调用 Codex，正常完成。
- 任一路失败、超时、缺失、输出无效、材料读取失败或证据不足时 review 失败，保留已核实 findings，不显示“未发现问题”。失败不自动重试、不换模型、不降级。
- 人工取消或强制超时以 GitHub 实际状态为准，不能保证 artifact，不能合成完成报告。
- 当前实现分支：机器结果与原始证据保存在 artifact，不经 job output 传递大文本；评论连包装不超过 50,000 字符时完整发布，不另出报告。超长详情使用 Job Summary，旧版下载式报告仅作为历史行为保留在验收记录。
- 报告包含 Standards、AI Review Rules、Summary、固定 head/base、模型/CLI 和证据位置。
- execute 按 PR 取消旧执行；comment 独立按 PR 串行，不主动取消发布者。

## 上线、验收与回退

阶段一先合入 skill 适配及共用证据模块，保留通用 PR 审查；阶段二以已有可信入口的 main 为 base 切换三个 job，完成真实 PR 验收；阶段三验收通过后独立提交移除本地自动审查配置，并调整 setup-huasu，保留中文、skill 和手动调用。

正式验收失败不合入 workflow 切换；上线故障回退 workflow 切换提交。不恢复本地自动审查，不自动启用多进程执行器。

本地机械验证：`node --test .agents/skills/code-review/scripts/ci-review.test.mjs .agents/skills/code-review/scripts/ci-capability.test.mjs`（29 项）、`actionlint -shellcheck=`、`git diff --check` 均通过。不启动本地自动 code-review。

| 正式验收项目 | 当前记录 |
| --- | --- |
| 共用模块抽取后的能力回归 | [42980002970](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42980002970)，通过：六路身份/模型/终态及 prepared 演练已核对 |
| 正式普通代码及零文本路径 | [正式 PR](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42981522611) 三 job 成功；[零文本](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42981795772) 完成且 workers=[]、outcome=skipped |
| 六路真实身份、完整材料、模型和终态 | 42981522611 的 report/evidence artifact 已下载核对，六路独立且完成、完整材料摘要一致、模型继承确认 |
| 已知缺陷 finding 且检查成功 | [42981926576](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42981926576)：sum([]) 缺少初始值的 Major 保留，三 job 成功 |
| 执行失败检查失败及失败报告 | [42981994642](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42981994642)：execute/review 失败、comment 成功；result.status=incomplete，明确不能判定无问题 |
| head 修改自身 skill/配置仍使用 base | 42981926576：artifact skillHash=fb59b435… 与 base c651e62 相等，和 head 53e6926 的 9ef60c84… 不同；六路模型仍为 gpt-6.1-sol。AGENTS 标记作为 Standards 数据读取，未改变输出 |
| opened/synchronize/reopened/ready_for_review | opened=42981522611；草稿跳过=42981717370；ready=42981795772；reopened=42982042237；synchronize=42982278222；force push=42982325099，均符合预期 |
| 连续推送、force push、旧 run/attempt 不覆盖 | fixture 旧 head 运行 42981816353 实际 cancelled，新 head 42981926576 成功；force push 42982325099 成功；同 SHA 较旧 run 42982325099 attempt 2 的发布日志明确为 newer-result，未覆盖较新 42982471807。本地 publisher 测试通过 |
| 长报告完整保存、源码拒写与临时写成功 | 共用模块回归 42980002970 prepared 已通过并下载；正式报告 artifact 可下载，超 50,000 字符发布分支本地测试通过。未在真实 PR 强制生成超长模型报告或尝试源码写入，不将其标为正式 PR 已执行 |

以下保留前置验证历史，涉及“尚未正式接入”的描述属于对应历史阶段，不代替上述正式验收记录。

## 12. 前置验证实现与操作说明

已新增独立手动工作流 `Codex skill capability probe`（`.github/workflows/codex-skill-capability.yml`）。正式 PR 审查、本地自动触发及原有六条规则均保持现状。

验证材料和入口集中在 skill 中：`scripts/ci-capability.mjs` 负责 fixture、可信读取、事件白名单投影和结果判定；`references/ci-capability-*.md` 为能力探测及演练提示词，JSON schema 只约束最终交付形状，不替代审查规则。

### 固定配置

| 项目 | 值 |
| --- | --- |
| Codex CLI / Responses API proxy | `0.167.1`，已通过 npm 确认两个包均可获取 |
| Codex Action | `1d82a3dba7c7988ec71ecae1ed5b8e8db96495c5`（核对时的 `v1`） |
| 模型 / effort | `gpt-6.1-sol` / `low` |
| endpoint | 沿用 `https://gptapi001.huasu.org/v1/responses` |
| 权限 | `contents: read`，无评论写入权限 |
| sandbox / safety | probe 为 `read-only`；prepared 演练为 `capability-temp`（只读继承，仅 runtime-tmp 可写）；`drop-sudo` |
| 运行环境 | `ubuntu-latest`；每个 Codex job 外层 40 分钟 |
| 子代理开关 | 不添加；所选 CLI 的 `features list` 显示 `multi_agent` 为 stable、默认 true |

本地 `npx --yes @openai/codex@0.167.1 exec --help` 已确认所用 CLI 的命令接口；这不代表 Linux runner 原生委派或自定义 endpoint 已验证。

### 运行顺序

1. 先将新增工作流及 skill 验证入口合入默认分支。配置现有 `OPENAI_API_KEY` Actions secret；不要将密钥写入仓库。
2. 在 GitHub 的 Actions 页面选择 `Codex skill capability probe`，点击 Run workflow 并选择可信 ref。选定提交是本次工具可信版本；该工作流不接收 PR 内容，也不从未选定提交加载代码。
3. `probe` 在仓库外建立临时 Git fixture，原样调用现有快照 helper；随后运行能力探测。缺密钥时不调用模型，仍尝试保留环境材料。
4. `assess-probe` 从事件证据判定是否具备六路独立身份、模型继承、终态、并发、取消、源码只读及结果交付能力。缺证据或输出无效则不启动完整演练。
5. 只有门槛通过才在独立 `rehearsal` job 调用 skill。快照生成通过时使用 native 模式，否则使用 prepared 模式验证预构建快照适配；不在原失败会话内重试。
6. `report` 无论前置成功或失败均尝试汇总。查看 Actions Summary 并下载 `capability-report`；完整材料分别在 `capability-probe`、`capability-rehearsal`，保留 7 天。不会发布 PR 评论。

`drop-sudo` 的实际实现不能在同一 Linux job 重复执行，因此探测和演练必须使用独立 job。工作流取消策略为不自动取消旧验证，以免把未确认停止的任务当作空闲任务启动替代运行。

### 证据来源与保守判定

在 Codex 启动前启动无密钥的独立观察进程。它读取本次专用 Codex home 的会话事件，只发布固定字段：任务身份、事件类型、模型、终态、材料 hash 以及可信测试命令的执行结果。原始 prompt、工具输出、认证文件、代理日志和完整环境变量不进入 artifact。

模型最终消息写入 private 目录。观察进程只输出符合 schema、经过凭据形状脱敏的 fixture 报告；长交付文本必须与准备阶段生成的内容完全一致，否则不发布该文本并标记未验证。父模型自行声称六路完成不能让门槛通过。记录不足、事件格式变化或模型通过无法关联的工具封装调用时，一律 `UNVERIFIED`，不猜测成功。

取消测试要求宿主报告控制任务 running，并通过 close 事件或关联的 V2 宿主状态查询确认非 completed 的有效停止终态。规则必须有独立身份、完整材料摘要以及有效 completed 输出证据。模型继承同时核对 spawn 参数没有 model 覆盖、实际 spawn 模型及子会话 turn context；缺少任一证据不通过。事件时间仅用于判定任务区间重叠，不冒充宿主提供的执行耗时。

Codex 之后仅运行固定的基础设施动作：`github-script` 写入 Action 实际 outcome 并等待已启动观察进程封存，之后上传固定 public 目录。它们不启动仓库脚本。审查和原始日志所在 private/Codex home 均不上传。独立汇总 job 从固定提交加载汇总入口，将报告只作为数据读取。

无害 AGENTS 标记测试只验证该标记没有改变本次最终输出，并记录实际文件读取；它不能证明指令从未加载，也不等价于完整防注入保证。

### 当前验证状态

- 已实现：手动触发、独立 fixture、原版 helper 复用、运行事件投影、六路门槛、取消证据判定、prepared 演练分支、长报告完整性校验及独立汇总。
- 本地检查：新增 Node 测试覆盖无密钥/失败 outcome、缺失终态、模型继承证据缺失、材料摘要缺失、权限失败、长报告截断、日志字段过滤及真实 fixture 快照；测试是本地模拟和 helper 验证，不是云端成功证据。
- 检查记录：新增测试与 actionlint 工作流校验已通过；扩展运行原有测试时共有 8 项失败，涉及 Windows 特殊文件名、符号链接权限、Git shell 模拟及 CRLF frontmatter 匹配。原有相关文件未修改，本轮不扩展修复；这些失败不作为本次云端能力不支持的证据。
- 初始实现阶段未执行云端验证；后续实际运行与复核见下方日期记录。
- 当前接入结论：**原生方案暂不可接入（关键云端能力尚未验证，不表示已证实不支持）**。实际运行后由报告按证据给出三类结论之一；只有 native 完整演练及快照/权限通过，才可写“可直接接入”。

本轮不移除本地自动审查、不修改生产 SKILL 调度规则，也不实现多实例执行器。

### 2026-11-11 云端复核与修正

首次运行：https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42967024728 （提交 `72d95fd10606b3726aff22a38f4b458cfffc329d`）。工作流成功，能力并未通过：环境与长消息交付 PASS，完整演练 skipped。原始日志确认 skill 读取和源码写入拒绝成功，快照 helper 与临时写入失败，但旧汇总将这些操作全部标为 UNVERIFIED，存在证据采集遗漏。

已按固定 CLI `0.167.1` 的协议实现修正：该版本不持久化 transient `exec_command_end` / `collab_*` 事件，应读取 `item_completed` 的 typed command/function output/activity；兼容 V2 `list_agents` 的真实状态。子会话元数据、父调用和子会话 turn context 用于核对身份及模型继承。缺少对应宿主证据仍保持 UNVERIFIED，不采用最终模型自述补齐。

权限依据：[官方 permission profiles 文档](https://developers.openai.com/codex/permissions)。`:read-only` 不提供临时写入豁免。基线 probe 保持 read-only；只有门槛满足且快照失败时，在独立 prepared job 中使用 `capability-temp`：继承 `:read-only`，仅允许本次 `runtime-tmp` 写入，同时再次验证源码写入被拒绝。该调整只验证最小适配，不改变 skill 核心规则，不能得出原样直接接入的结论。

失败诊断只保留固定分类（权限拒绝、范围不匹配、未知 helper 失败），不上传任意 stderr。增加事件类型计数帮助识别协议缺口，不上传原始会话日志。

修正后运行：https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42970143474 （提交 `2462b60`），核对中；运行最终结论见后续记录。

本次本地 17 项能力验证测试、`actionlint -shellcheck=` 与 `git diff --check` 通过。按用户要求停止本地自动 code-review，本次不启动。

### 后续修正记录与验收口径

- V2 fork 文件可能包含父会话元数据与历史。观察器按宿主 `subagent_history_start_ordinal` 排除继承范围；旧格式没有可靠边界时，不将其中事件计为 worker 自身证据。探测与演练的 worker 显式 `fork_turns: "none"`，仍不传 model，由宿主配置和自身 turn context 核对模型继承。
- 同一 worker 的 legacy/typed/activity/session 元数据按运行时 thread ID 合并。V2 `list_agents` 可能省略较早完成任务，因此同时保留子会话真实 `task_complete` / `turn_complete` 的有效输出判定；不从父模型的总结补造终态。
- 独立任务消息完整携带 SKILL 第 2 节的输出要求；缺少严重程度、文件或行号等仍视为无效，不放宽有效性标准。新增固定输出格式诊断，不发布原始 worker 日志。
- 取消探测以专门的 `control_cancel` 身份关联宿主 running 与 interrupted 状态，不依赖模型在总结中声称取消成功。

| 运行 | 验证提交 | 核对结果 |
| --- | --- | --- |
| [第一轮修正](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42970143474) | `2462b60` | skill 与指令边界 PASS，快照和临时写入明确为权限失败；发现身份归属及 V2 状态采集遗漏 |
| [第二轮修正](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42971009574) | `ccab697` | 采集到原生六路和模型上下文；随后发现 fork 继承历史归属风险，其并发记录不作为最终验收依据 |
| [终态采集修正](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42971928999) | `f82e492` | 取消链路可关联；仍使用旧 fork 口径，不作为最终完整能力验收依据 |
| [独立上下文验证](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42972580081) | `6367a95` | 并发、模型继承、取消与五路有效输出通过；Standards 为 completed / invalid_output，完整演练未启动 |
| [输出约定修正](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42973379962) | `9419253` | 原生能力门槛和 prepared 完整演练通过；最终结论为需最小适配后接入 |

当前本地针对性回归测试为 19 项通过，静态检查通过；测试覆盖协议投影、未授权输出伪造、fork 边界、身份合并、完成终态及取消门槛。云端验收通过与否只依赖实际 artifact，不以本地模拟测试代替。

### 最终验收结果（2026-11-11）

最终运行：[42973379962](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42973379962)，验证实现提交 `9419253c0f4942864c6fa826a791264fe27dff9e`。probe、assess-probe、rehearsal、report 四个 job 均成功。已下载并独立核对 `capability-probe`、`capability-probe-assessment`、`capability-rehearsal`、`capability-report`，不只依赖工作流绿色标记或模型自述。

| 能力 | 只读 probe | 独立 prepared 演练 |
| --- | --- | --- |
| 环境与指定 skill 读取 | PASS | PASS |
| 六路独立原生委派、有效终态及完整材料读取 | PASS | PASS |
| 并发及模型继承 | PASS | PASS |
| 取消（独立控制任务） | PASS | 未重复执行；采用 probe 证据 |
| 原版快照 helper 在沙箱内构建 | FAIL：filesystem_permission_denied | 未重复执行；使用可信步骤预构建材料 |
| 源码只读及必要临时写入 | FAIL：源码保护通过，但临时写入被拒绝 | PASS：源码写入被拒绝，runtime-tmp 写入成功 |
| 指令边界 | PASS | PASS |
| 长消息交付 | PASS | PASS |
| 完整 skill 演练 | 未执行 | PASS（明确为适配演练） |

两个 job 各有六个唯一规则 worker，全部 completed，实际模型均确认是 `gpt-6.1-sol`；每个 job 内六路 manifest/patch 摘要一致。两个最终交付均为完整 700 行，SHA-256 与准备值一致。控制任务由宿主状态确认在 06:36:30.718 UTC 为 running，06:36:36.322 UTC 为 interrupted。执行耗时接口不可用，未将事件时间跨度冒充 worker 执行耗时。

prepared 报告按 Standards、AI Review Rules、Summary 交付，并核查出临时 fixture 的一个 Major：sample.js 第 1 行把 double 从乘二改成乘三。报告明确保留预构建目录、未宣称原版 helper 在只读沙箱内成功。

**最终结论：需最小适配后接入。** 原生委派已证实可用，无需多进程执行器。正式接入应继续使用 skill 内原规则与 helper，并明确以下适配：可信准备步骤在 Codex 沙箱外预构建快照；调用方传入同一 manifest；命名权限只开放专用临时目录；调用方持有的材料由调用方负责生命周期；独立 worker 传递完整任务及 skill 输出约定，使用自身上下文验证模型。正式 skill 的预构建材料入口与清理约定仍需显式纳入接入改造，本次仅通过验证提示词演练，未修改 SKILL 核心规则，也未启用正式 PR skill 调用。

PR：https://github.com/lu-keer/nuxt_huasu_review/pull/2 。本次保留正式 PR 触发方式及原 skill；按用户要求不启动本地自动审查。19 项本地针对性测试、工作流 actionlint 与 git diff 检查通过。最新验证实现的现有 PR 云端静态审查通过，且未报告有充分证据支持的新问题；该检查不替代本次独立能力验收。

## 正式接入实施：第一阶段

新增 skill 内的 `ci-review.mjs` 可信准备、材料读取、证据校验和报告发布入口，新增 CI context/result schema 与调用提示词。原 helper、过滤及规则正文保持不变；`ci-runtime.mjs` 共用宿主事件投影，验证流程继续独立保留。

正式约定：固定 base/head，从 base 导出完整 skill；原 helper 在调用前构建快照，`materials` 与可信工具只读，仅 `runtime-tmp` 可写。主会话在仓库外 controller 启动；六路使用独立上下文并继承模型。材料归调用方持有，终态未知时保留，由 runner 生命周期回收。完整报告保存 artifact，findings 不阻断；执行、材料或证据不完整则检查失败。

第一阶段仍保留现有通用 PR workflow。先合入可信入口，再在后续 PR 切换 execute/review/comment 三 job，避免 base 缺失入口时回退读取 head。若正式验收失败，保留原 workflow；上线故障回退 workflow 切换提交，不恢复本地自动审查，不启用多进程执行器。

本地机械验证：`node --test .agents/skills/code-review/scripts/ci-review.test.mjs .agents/skills/code-review/scripts/ci-capability.test.mjs`，`actionlint -shellcheck=` 与 `git diff --check`。正式云端结果将在实际运行后补充，当前不标记完成。本次不启动本地自动 code-review。

取消边界：除 `cancelled()` 外，review/comment 显式要求 `needs.execute.result != 'cancelled'`，避免 job 级取消被误作执行失败继续合成报告。取消保护验证使用运行 [42983040977](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42983040977)，由后续文档提交触发新的 execute 并取消该旧执行；最终实际状态将记录在上线验收中。

## 上线验收与本地流程退出（2026-11-11）

- 第一阶段 PR #3 已合入 main（ad8175d），能力回归 42980002970 的 probe/prepared 各六路身份、材料、模型和终态已核对。
- 第二阶段 PR #4 已合入 main。最终正式验收 [42983188198](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/42983188198)，固定 head `888c9db659a3ab72b374c0beeddd0e241e8ddc1e`、可信 base `ad8175d697822e96f7900082fafaeee0644bbd31`；execute/review/comment 全部成功。已下载 report/evidence，六路独立、completed、modelConfirmed 全部为 6，reasons=[]，findings=0。
- 取消保护验收 42983040977：execute cancelled，review/comment skipped，无合成报告。较早运行暴露的 job 级取消边界已修复。
- 已知缺陷与异常验收见上表。临时 PR #5/#6/#7 已关闭，缺陷、无害配置标记与失败注入均未合入 main。
- 第三阶段独立移除根 AGENTS 的本地自动触发及桌面自动调度要求，setup-huasu 不再写回这些内容；保留中文交流、code-review skill、依赖和锁文件条目及显式手动调用。
- 不恢复本地自动审查。后续 workflow 故障可回退 PR #4 的正式 workflow 切换；能力验证 workflow 保留用于 CLI/Action 升级回归。

验证范围限制：没有在真实 PR 强制生成超过 50,000 字符的模型报告或执行源码写入尝试。长报告摘要/完整保存经本地机械测试，源码拒写/临时可写及模型长消息经独立能力回归验证，不将其冒充正式 PR 中重复执行的结果。

## 固定评论模板（实现分支）

正文固定为 Standards、AI Review Rules、Summary，五条规则表格展示。问题来源与剔除/合并统计通过 version 2 schema 传递；未知统计为 null。独立校验状态优先于模型自述。

评论完整时仅生成机器结果，不生成重复 report.md，也不提供下载式报告入口。超长详情写入 review job 的 Job Summary，每步最多 900,000 字节、最多 20 步；通过当前 run/attempt 的 Actions API 查询真实 review job ID，生成运行总览的 `#summary-{jobId}` 直达链接。写入或定位失败时发布明确交付失败提示，检查失败，仍保留有效问题和机器结果。摘要继承 Actions 权限和运行保留周期，不是永久文档。

机器结果与白名单原始证据分别通过 artifact 跨 job 传递，保留 7 天；artifact 不作为在线文档入口。隐藏标记、固定 head/run/attempt 校验及过期发布保护不变。详见 [评论规范](ci-review-comment-spec.md)。默认分支是否已上线及真实验证见后续验收记录。
