# CI 审查结果评论正文规范与改造方案

> 状态：实现分支已接入固定模板；真实云端验收结果另见验收记录。本文不代表默认分支已上线。

## 1. 现状与目标

PR #17 的 [github-actions 审查评论](https://github.com/lu-keer/nuxt_huasu_review/pull/17#issuecomment-6812863205) 已完成六路审查及严格调度校验，但展示存在以下问题：

- Standards 前堆叠 head、base、CLI、模型及调度信息，主要结论不够集中。
- 正文包含 agent 路径、runner 绝对路径及 `NO_FINDINGS` 等执行细节。
- 五条 AI 规则使用长列表，没有统一的状态和核实结果表格。
- 多次重复说明耗时不可用；排版依赖模型自由生成。
- “完整报告与证据”链接指向 Actions artifact，不能直接阅读文档；报告与评论存在重复。

目标是让审查者直接读到覆盖范围、真实完成状态、核实问题及汇总结果；执行证据保留可追溯性，但不挤占主要正文。

### 参考案例

| 参考会话 | 可借鉴的展示方式 | 本方案采用方式 |
|---|---|---|
| [审查当前分支提交变更](codex://threads/01a1a546-7137-72f0-a8cf-db0298cf93c8)（图 1） | 无问题时简洁陈述；五条规则表格化；汇总集中 | 作为无问题模板基础 |
| [审查相对 dev 的分支变更](codex://threads/01a1a54f-7061-7eb3-945b-87341b59fe3c)（图 2） | 严重程度、代码位置、触发条件和影响；跨规则重复引用 | 作为有问题模板基础 |
| [查看名片社交功能实现](codex://threads/01a1a48e-e1cf-7273-9186-7f45f66277ff)（图 3） | 简短列出关键问题与影响 | 用于超长评论的问题索引，不替代任务状态 |
| [分析当前分支改动](codex://threads/01a19b77-3208-7143-b446-46f61f27e425)（图 4） | 简洁的规则表格和去重汇总 | 用于压缩重复叙述 |

参考案例是本地审查展示样式，不是本项目 CI 与本地审查结果等价的证明。本地绝对路径、材料清理提示及自动审批信息不机械搬入 CI 评论。

## 2. 评论正文规范

可见正文固定从 `### Standards` 开始，依次为 `### AI Review Rules`、`### Summary`。用于定位和更新评论的隐藏标记继续保留，不视为正文。

| 区域 | 必须包含 | 表达规范 |
|---|---|---|
| Standards | 实际状态、覆盖范围、核实问题 | 无问题一句话；有问题按问题规范展开 |
| AI Review Rules | 五条相对规则路径、各自状态、核实结果 | 固定五行表格，顺序为 architect、devops、product_contract、runtime_performance、security |
| Summary | 整体状态、去重后问题数量及严重程度、最高严重程度、剔除和合并数量 | 区分过程完整与代码问题，不重复问题详情 |
| 验证与耗时 | 构建、测试、复现是否执行；真实可用耗时 | 放在 Summary 中集中说明一次；缺失写“不可用”，不估算 |
| 审查范围与执行证据 | 固定 base/head、工具配置、调度结果、必要身份和材料信息 | 使用 `<details>`；失败原因同时在可见 Summary 展示 |
| 底部入口 | Actions；确有必要时的在线补充文档 | 不展示重复报告或 artifact 文档入口 |

状态展示使用“已完成”“失败”“超时”“已取消”“未启动”“终态未确认”等明确文字；实际错误原因不能被统一的“未完成”掩盖。内部状态映射及原始终态保存在机器结果中。

“未发现问题”仅用于对应任务已完成且核查有效的情况。整体未完成时，写“当前已核实 N 项问题，不能据此判定未发现问题”。无可审查文本不是六路均完成，五条规则应标为未运行。

覆盖范围来自同一可信 manifest。某项读取不完整时，不得声称该项已覆盖全部文件。六路状态、规则来源和 findings 来源必须有对应证据。

## 3. 问题展示与统计规范

- 去重后分配 `F1`、`F2` 等编号；按 Critical、Major、Minor 排序，同级按文件路径和行号排序。编号在本轮报告内稳定，不承诺跨提交稳定。
- 每项问题包含严重程度、简短标题、文件行链接、触发条件、关键代码依据及影响。代码仅引用定位问题必需的片段。
- Standards 保留的问题在 Standards 展开；仅由 AI 规则保留的问题在规则表格后展开。多个来源引用同一编号，详情只出现一次。
- 规则表格同时记录该规则的实际状态及核实结果，例如“F1（与 Standards 重复）、F2”。未完成规则也可保留已核实问题，但不能据此标为完成。
- 总数只计算去重后保留的问题。剔除数指核查后删除的候选数，合并数指归并掉的重复候选条数；缺失时写“未提供”，不能补零。
- 文件链接使用 GitHub 仓库相对路径、固定提交和有效行号，不使用本机路径或 runner 路径。head 中的代码链接到完整 head SHA；已删除代码链接到对应 base/旧提交的真实行号。路径按 URL 规则编码。
- 标题、文件路径、代码、错误原因及表格文本需要 Markdown/HTML 转义，不能让待审内容破坏模板或注入伪造段落。

## 4. 报告、在线文档与原始证据

评论是主要交付。评论完整展示结果时，不额外生成重复的完整报告，也不输出报告链接。内部机器结果和原始执行证据不是重复的人类报告，可继续作为跨 job 数据及排障材料保存。

只有评论超长或确有补充详情时才生成独立文档，入口名称为“查看详细审查文档”，必须能在浏览器直接阅读。Actions artifact 下载页不属于在线文档，不再使用“完整报告与证据”作为下载入口名称。

默认底部仅展示“查看 Actions”。补充文档不得提交到被审 PR 以改变审查 head，也不能未经决定直接提交到默认分支。在线详情使用 review job 的 Actions Job Summary，继承 Actions 的访问权限与运行保留周期；不新增仓库内容写权限，不保证永久地址。通过 GitHub API 查询当前 run/attempt 的真实 review job ID，使用运行总览的 `#summary-{jobId}` 锚点直达正文（job URL 默认打开日志）。按完整段落拆分，每步不超过 900,000 字节，最多 20 步；单段或总量超限即明确交付失败，不使用下载链接替代。

原始白名单执行证据继续由 Actions artifact 保存，保留现有敏感信息过滤边界。正文不输出无用的 runner 绝对路径；准确材料位置、任务身份和读取证据留在诊断数据中。材料由 CI 调用方持有，不将 runner 回收描述为已执行显式清理。

## 5. 改造后规范示例

以下代码块是评论 Markdown 模板。示例 5.1 使用 PR #17 已核实的历史数据，仅用于展示新格式，不表示该 PR 已发布新模板。其余示例均为演示数据；`{{...}}` 是发布前必须替换的占位符，不可原样发布。文件位置及在线文档链接在替换后必须实际有效。

### 5.1 完成且无问题：PR #17

```markdown
### Standards

已完成，覆盖全部 2 个可审查文本文件，未发现问题。

### AI Review Rules

以下五项均覆盖同一份完整变更，规则路径相对于 `.agents/skills/code-review/`：

| 规则路径 | 实际状态 | 核实结果 |
|---|---|---|
| `references/ai_review_rules/architect.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/devops.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/product_contract.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/runtime_performance.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/security.md` | 已完成 | 未发现问题 |

### Summary

六项必要审查全部完成，未发现高置信度问题。
最终保留 0 项问题；最高严重程度：无。剔除 0 项候选，合并 0 项重复报告。

未修改代码，未运行项目构建、测试或复现实验。
worker 实际耗时及独立墙钟等待时长不可用，未作估算。

<details>
<summary>审查范围与执行证据</summary>

- 范围：2 个可审查文本文件，新增 173 行、删除 5 行。
- 审查 head：[e29436d](https://github.com/lu-keer/nuxt_huasu_review/commit/e29436df3dab412edcb79ce6790a1786294738f7)。
- 可信规则 base：[02d51fc](https://github.com/lu-keer/nuxt_huasu_review/commit/02d51fc311c4d1ab9964c4e3177c6b212ee8f652)。
- CLI：`0.167.1`；模型：`gpt-6.1-sol / low`。
- 严格调度：PASS；worker 容量 6，实际最大并发 2。
- 六路均确认完成；任务身份、材料读取记录及准确材料位置保存在 Actions 执行证据中。
- 预构建材料由 CI 调用方持有，模型未执行清理。

</details>

[查看 Actions](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43143337887)
```

### 5.2 完成且有问题（演示）

```markdown
### Standards

已完成，覆盖全部 40 个可审查文本文件。

- **F1 · Major：无社交组件时无法添加首条链接** — [social.vue:756]({{固定提交文件行链接_F1}})

  触发条件：初始查询及补查均未返回 `link_id`。
  代码依据：原创建分支已移除，当前直接提示失败并返回。
  影响：尚无组件的页面无法添加首条社交链接。

### AI Review Rules

以下五项均覆盖同一份完整变更，规则路径相对于 `.agents/skills/code-review/`：

| 规则路径 | 实际状态 | 核实结果 |
|---|---|---|
| `references/ai_review_rules/architect.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/devops.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/product_contract.md` | 已完成 | F1（与 Standards 重复）、F2 |
| `references/ai_review_rules/runtime_performance.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/security.md` | 已完成 | 未发现问题 |

- **F2 · Minor：未请求粉丝数就显示获取失败** — [social.vue:266]({{固定提交文件行链接_F2}})

  触发条件：已开启粉丝数展示，但条目没有统计数据。
  代码依据：初始化未发起补取请求，缺失数据直接进入失败展示分支。
  影响：用户必须重试或重新切换开关才能获取数据。

### Summary

六项必要审查全部完成。最终保留 2 项问题：1 Major、1 Minor；最高严重程度：Major。
剔除 0 项候选，合并 1 项重复报告。

未修改代码，未运行项目构建、测试或复现实验。
worker 实际耗时及独立墙钟等待时长不可用，未作估算。

<details>
<summary>审查范围与执行证据</summary>

- 范围：40 个可审查文本文件；base：{{完整 base SHA}}；head：{{完整 head SHA}}。
- CLI、模型及 effort：{{经验证的运行配置}}。
- 严格调度：PASS；六路任务均确认完成。
- 任务身份、读取记录及材料保留信息保存在 Actions 执行证据中。

</details>

[查看 Actions]({{Actions URL}})
```

### 5.3 部分未完成且保留有效问题（演示）

```markdown
### Standards

已完成，覆盖全部 2 个可审查文本文件。

- **F1 · Minor：错误分支缺少用户反馈** — [example.vue:42]({{固定提交文件行链接_F1}})

  触发条件：提交接口返回业务错误。
  代码依据：错误分支直接返回，没有更新反馈状态。
  影响：用户无法判断提交失败或继续处理。

### AI Review Rules

规则路径相对于 `.agents/skills/code-review/`：

| 规则路径 | 实际状态 | 核实结果 |
|---|---|---|
| `references/ai_review_rules/architect.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/devops.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/product_contract.md` | 已完成 | F1（与 Standards 重复） |
| `references/ai_review_rules/runtime_performance.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/security.md` | 超时 | 未取得有效核实结果 |

已完成规则均覆盖同一份完整变更；security 的完整覆盖未确认。

### Summary

审查未完成：security 超时，六项必要审查仅 5 项完成。
当前已核实 1 项 Minor，最高严重程度：Minor；不能据此判定未发现其他问题。
剔除 0 项候选，合并 1 项重复报告。

未修改代码，未运行项目构建、测试或复现实验。
worker 实际耗时及独立墙钟等待时长不可用，未作估算。

<details>
<summary>审查范围与执行证据</summary>

- 范围：2 个可审查文本文件；base：{{完整 base SHA}}；head：{{完整 head SHA}}。
- CLI、模型及 effort：{{经验证的运行配置}}。
- 调度验收：{{实际调度状态}}；任务完成状态与调度状态独立记录。
- 超时任务：{{security 原生身份}}；原始终态：{{宿主记录}}；停止确认：{{真实结果}}。
- 已停止任务及材料保留记录见 Actions；未确认停止时保留材料，不能声称清理完成。

</details>

[查看 Actions]({{Actions URL}})
```

### 5.4 调度 FAIL / UNVERIFIED（演示）

以下演示为调度无法验证但六路规则本身完成。实际为 FAIL 时，将状态替换为 FAIL，原因替换为真实原因；若规则本身也未完成，表格必须同步反映，不能照抄“已完成”。

```markdown
### Standards

已完成，覆盖全部 2 个可审查文本文件，未发现问题。

### AI Review Rules

以下五项均覆盖同一份完整变更，规则路径相对于 `.agents/skills/code-review/`：

| 规则路径 | 实际状态 | 核实结果 |
|---|---|---|
| `references/ai_review_rules/architect.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/devops.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/product_contract.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/runtime_performance.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/security.md` | 已完成 | 未发现问题 |

### Summary

审查未完成：严格调度为 UNVERIFIED，容量证据缺失。
六路规则均已完成，但整体执行未通过独立验收。
当前已核实 0 项问题，不能据此判定未发现问题。
剔除及合并数量未提供。

未修改代码，未运行项目构建、测试或复现实验。
worker 实际耗时及独立墙钟等待时长不可用，未作估算。

<details>
<summary>审查范围与执行证据</summary>

- 范围：2 个可审查文本文件；base：{{完整 base SHA}}；head：{{完整 head SHA}}。
- CLI、模型及 effort：{{经验证的运行配置}}。
- 严格调度：UNVERIFIED；原因：{{校验器实际原因码及说明}}。
- 任务身份、读取记录及材料保留信息保存在 Actions 执行证据中。

</details>

[查看 Actions]({{Actions URL}})
```

### 5.5 无可审查文本（演示）

```markdown
### Standards

无可审查文本变更，未启动 Standards 审查。

### AI Review Rules

规则路径相对于 `.agents/skills/code-review/`：

| 规则路径 | 实际状态 | 核实结果 |
|---|---|---|
| `references/ai_review_rules/architect.md` | 未运行 | 无可审查文本 |
| `references/ai_review_rules/devops.md` | 未运行 | 无可审查文本 |
| `references/ai_review_rules/product_contract.md` | 未运行 | 无可审查文本 |
| `references/ai_review_rules/runtime_performance.md` | 未运行 | 无可审查文本 |
| `references/ai_review_rules/security.md` | 未运行 | 无可审查文本 |

### Summary

本次范围检查完成，没有可审查文本变更，未调用模型或启动 worker。
未产生审查问题；剔除及合并不适用。此结果不代表已审查所有非文本或被过滤文件。
未运行项目构建、测试或复现实验；审查耗时不适用。

<details>
<summary>审查范围与执行证据</summary>

- 可审查文本文件：0；base：{{完整 base SHA}}；head：{{完整 head SHA}}。
- 严格调度：NOT_APPLICABLE。
- 文件过滤结果及材料记录保存在 Actions 执行证据中。

</details>

[查看 Actions]({{Actions URL}})
```

### 5.6 评论超长（演示，依赖在线文档能力）

保留三段结构、五条规则状态、完整计数、最高严重程度、未完成原因及问题索引。优先移出冗长代码证据和详情，不任意截断 Markdown 或问题句子。问题索引仍超限时按严重程度保留可容纳条目，明确显示已展示与未展示数量；完整详情必须在成功发布的在线文档中可读。

```markdown
### Standards

已完成，覆盖全部 40 个可审查文本文件；核实 F1。
问题详情见在线审查文档。

### AI Review Rules

以下五项均覆盖同一份完整变更，规则路径相对于 `.agents/skills/code-review/`：

| 规则路径 | 实际状态 | 核实结果 |
|---|---|---|
| `references/ai_review_rules/architect.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/devops.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/product_contract.md` | 已完成 | F1（重复）、F2 |
| `references/ai_review_rules/runtime_performance.md` | 已完成 | 未发现问题 |
| `references/ai_review_rules/security.md` | 已完成 | 未发现问题 |

### Summary

六项必要审查全部完成。最终保留 2 项问题：1 Major、1 Minor；最高严重程度：Major。
剔除 0 项候选，合并 1 项重复报告。

问题索引（已展示 2/2）：
1. **F1 · Major**：[问题标题]({{固定提交文件行链接_F1}})。
2. **F2 · Minor**：[问题标题]({{固定提交文件行链接_F2}})。

详细证据超出评论长度限制，已移至在线审查文档。
未修改代码，未运行项目构建、测试或复现实验。
worker 实际耗时及独立墙钟等待时长不可用，未作估算。

<details>
<summary>审查范围与执行证据</summary>

- 范围：40 个可审查文本文件；base：{{完整 base SHA}}；head：{{完整 head SHA}}。
- CLI、模型及 effort：{{经验证的运行配置}}；严格调度：PASS。
- 任务身份、读取记录及材料保留信息保存在 Actions 执行证据中。

</details>

[查看详细审查文档]({{已成功发布且可直接阅读的文档 URL}}) · [查看 Actions]({{Actions URL}})
```

## 6. 文件改动清单与数据流

以下列明实现涉及的职责和验收点；上线情况以真实验收记录为准。

| 文件 | 当前职责 | 拟改内容 | 依赖与验收点 |
|---|---|---|---|
| `.agents/skills/code-review/references/ci-review-result.schema.json` | 定义模型最终 status、report、tasks、findings | 为去重后的 finding 增加来源规则；增加剔除和合并统计，未知值显式表达；区分模型内容与最终发布状态 | 来源必须属于六条已知规则；统计不可从自由文本猜测；同步验证器与提示词 |
| `.agents/skills/code-review/references/ci-review.md` | CI 调用边界、六路输出及最终结果契约 | 明确来源归属、候选核查统计、去重及缺失数据表达；把固定排版交给模板代码 | 与 schema 同步；继续要求真实任务身份、状态及完整材料，不放宽六路义务 |
| `.agents/skills/code-review/scripts/ci-review.mjs` | 准备材料、观察证据、独立验收、生成 report.md/result.json、发布评论 | 从可信 manifest、核实内容及独立校验结果构建展示数据；确定性渲染正文与折叠区；生成固定提交链接；调整超长处理和发布接口；评论完整时不生成重复报告 | 校验器状态优先于模型自述；保留敏感信息过滤、隐藏标记及防过期发布；在线文档 URL 与 artifact URL 分离 |
| `.agents/skills/code-review/scripts/ci-review.test.mjs` | 验证结果校验、证据验收、超长报告及发布保护 | 增加各模板状态、统计、来源引用、链接、转义及无重复报告测试，更新旧 report.md 强依赖断言 | 使用真实结构 fixture 验证，不以字符串包含标题代替语义一致性 |
| `.github/workflows/codex-review.yml` | execute/review/comment 三 job 的执行、报告上传与发布 | 将机器结果/证据传递与可选人类文档分离；移除发布阶段必须存在 report.md 的条件及重复报告上传依赖；不再无条件传 REPORT_ARTIFACT_URL 作为文档入口 | result.json 等必要数据仍跨 job 可用；失败诊断先保存再失败；缺人类报告不等于证据缺失；保持现有最小权限与身份检查 |
| `docs/codex-action-skill-integration.md` | 描述当前 CI 接入、交付与验证行为 | 实现上线后同步正文、机器结果、可选在线文档和原始证据的区别 | 不能提前宣称功能已上线；注明在线托管及新版本验收结果 |

数据流调整为：可信材料与运行证据 → 独立验收 → 结构化发布数据 → 固定模板 → PR 评论。仅在需要时由相同发布数据生成补充文档，避免两套统计或状态来源。模型原始 report 按原有白名单证据策略保留，但不作为未经约束直接拼接的可见评论，也不另行包装成重复报告。

结构化改造须同步核对 observer 对最终 JSON 的验证和白名单封存，避免新增字段被丢弃。机器结果格式变化需要版本标记或明确的不兼容诊断；旧数据缺失来源和统计时不得编造默认值或被误判为完整新结果。

本改造不调整六路调度策略、固定容量与模型策略、严格验收门槛、任务预算、只读边界及旧 head 防覆盖机制。有效 findings 仍与过程完成状态分别处理。

## 7. 测试与上线验证

### 单元与契约测试

- 完成无问题：三个标题顺序正确，固定五行，无执行路径噪声和重复耗时，默认仅 Actions 链接，不生成重复人类报告。
- 完成有问题：F 编号、严重程度排序、来源规则引用及去重计数一致；详情只出现一次；统计未知显示“未提供”。
- 失败、超时、取消、终态缺失：保留实际状态及有效 findings；整体未完成，不显示整体“未发现问题”。
- 调度 FAIL/UNVERIFIED：即使六路完成也显示整体未完成，原因在可见 Summary 出现；独立校验不能被模型 complete 覆盖。
- 无文本：不调用模型、不启动 worker；五条规则未运行，调度不适用。
- 链接与转义：中文、空格、特殊字符路径、删除行、表格竖线、反引号及 HTML 均正确处理；链接绑定固定提交，禁止 runner 路径和未替换占位符。
- 长度边界：继续使用有余量的评论预算（现有实现为 50,000 字符），测试中英文、完整结构与问题索引裁减；不能截断 Markdown；只在在线文档成功发布后提供有效文档链接。
- 跨 job 与兼容：无 report.md 时有效机器结果正常发布；缺证据、格式不兼容、身份不匹配仍如实失败；旧 head、旧 run/attempt 不覆盖新评论。

建议验证命令：`node --test .agents/skills/code-review/scripts/ci-review.test.mjs`，并运行受接口变化影响的现有 CI 测试；workflow 改动使用项目可用的 actionlint 校验，最后执行 `git diff --check`。这些是后续实现的验收要求，不是本文记录的已通过结果。

### 真实 PR 验证与生效边界

1. 在线文档采用 review job 的 Job Summary；须核对真实 job URL、摘要上传结果与读取权限。
2. 当前正式 CI 从事件 base 导出可信 skill，自身修改 skill 的 PR 通常仍使用旧版本。通过以改造分支为 base 的验收 PR，或合入后的后续 PR 验证新模板；不能仅凭实现 PR 的旧模板检查认定新版本通过。
3. 核对 GitHub 实际渲染：标题、表格、折叠区、代码位置链接、同一评论更新及 Actions 入口。完整评论不得出现重复报告或下载式文档入口。
4. 用受控场景验证无问题、有问题、未完成、无文本和超长；已核实问题在失败场景仍保留，机器结果、评论与可选在线文档状态和计数一致。
5. 验证文档链接在目标审查者权限下可直接阅读，绑定本轮 head/run，且不会被后续运行覆盖为另一轮结果。
6. 将新 run、head、截图及结果写入新的验收记录。不改写历史验收记录为“新模板已通过”，不把历史绿色检查当作当前实现证据。

## 8. 本文交付验收

- 包含新规范、六类完整 Markdown 示例及明确文件改动清单。
- 明确真实历史数据与演示数据、当前行为与拟议行为。
- 评论完整时无重复完整报告；补充文档要求在线可读，托管采用 review job 的 Actions Job Summary。
- 未完成不等于无问题，未知统计不补零，缺失耗时不估算，代码位置绑定固定提交。
- 本文不构成 CI 实现、在线托管或真实 PR 新模板验收已完成的证明。
