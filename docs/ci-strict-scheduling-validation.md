# 严格调度验收记录（2026-11-12）

## 当前结论

实现已提交到草稿 PR #10，尚未合入或上线。固定 CLI `0.167.1`、`gpt-6.1-sol / low` 下，控制演练能够通过，但规则任务尚未稳定遵守提交队列约定；最新严格结果为 FAIL，完整演练跳过。不得以工作流 success 或最大并发为 2 宣称验收成功。

这不证明 CLI 缺少并发能力，也不证明 PR #9 的历史根因。旧报告原样保留；本地自动审查没有恢复。此次结果也不能补齐与改造前本地审查完全等价的证明。

## 固定运行与证据

| 提交 | Actions | 实际结论 |
| --- | --- | --- |
| `86e8fbc` | [43002409934](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43002409934) | 六路调度 FAIL，控制任务 FAIL，完整演练跳过 |
| `decfd9e` | [43004106125](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43004106125) | probe 调度和控制组 PASS；prepared 容量预检失败，未调用演练模型 |
| `c3f09dcc1d31bd2d13b3c353c36aa9638f051d17` | [43005960058](https://github.com/lu-keer/nuxt_huasu_review/actions/runs/43005960058) | probe 六路调度 FAIL，控制组 PASS，完整演练跳过 |

各轮均是修正后独立运行，不重试单个失败 worker。最新运行的 `capability-probe`、`capability-probe-assessment`、`capability-report` 已完整下载并核对；没有 `capability-rehearsal`，因为其未运行。原始白名单事件在 `capability-probe/events.json`，可信容量在 `runtime-contract.json`，调度结论在 assessment artifact 的 `assessment.json`。

## 最新运行的具体原因

`config/read` 确认两个子任务名额，不包含主会话；证据版本 2，配置摘要 `c01f00703ee2e3fbbd58b70b77607028c3236230c3140d7c8a630cc90dfe8f0d`。六个独立规则 worker 均有材料读取、模型确认和完成终态；实际最大并发为 2。调度原因码为 `WAIT_WITH_AVAILABLE_CAPACITY`。

父会话为 `01a1ca34-ddf2-7e10-86d4-4a80b1e6a534`。以下时间均直接来自运行时，使用 UTC；order 是父记录顺序，不是估算耗时。

| 已记录的完成事件 | 后续等待调用 | 尚待提交 |
| --- | --- | --- |
| Standards：10:44:28.107，order 46 | wait_agent：10:44:30.342，order 47，call `call_17a1fa4b2c6842c3927d010d3147d3d4` | devops（order 55 才提交）及后续规则 |
| devops：10:44:49.906，order 69 | wait_agent：10:44:50.722，order 70，call `call_7e27ca582a4446648a235c7580f61305` | runtime_performance（及 security） |

以上等待发生在 spawn 返回后，不能由 spawn 阻塞解释。仅把已投影的父会话完成通知作为已知释放依据，不用子任务结束时间推断父会话收到通知。未获取模型内部决策时点或实际 worker 执行耗时，不进一步断言底层原因。

快速控制组调度 PASS、实际最大并发 1；保持控制组调度 PASS、实际最大并发 2；每任务 30 秒及整组 5 分钟边界均通过。它们只证明受控任务的能力，不替代规则审查。

## 修正与发布边界

已修正的准备问题包括隔离 fixture 指令、等待保持 helper 的真实退出，以及为无模型 app-server 查询明确选择只读默认权限。Action 的命名权限与模型配置不变。规则任务提示已明确完成后立即补位；最新运行仍出现提前等待，因此停止发布，不继续重跑以获得偶然通过结果。

下一步需要解决规则任务的队列执行可靠性，并在新提交重新完成独立严格能力和完整六路演练；不能改为任意重叠验收、升级 CLI 或引入替代执行器。通过前不合入。新 base 的普通变更、零文本和受控缺证据 PR 尚未执行，PR 评论及正式 artifact 三路径验收也未完成。

本地 54 项针对性 Node 测试、`actionlint -shellcheck=`、`git diff --check` 已通过；这些结果不替代云端验收。当前 PR 使用旧 base 校验器且保持草稿，不能作为新门槛验收。上线后如需回退，使用明确 revert 恢复上一版本，并注明旧门槛只能证明有限的区间重叠。
