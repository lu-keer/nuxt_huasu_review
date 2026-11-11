# CI skill 完整演练

本轮与能力探测处于不同 job，不复用旧任务、不重试失败规则。只审指定临时 fixture，真实项目不得修改。不读取认证配置、完整环境变量或代理日志，不安装依赖、不访问网络。

六路原生 worker 均显式传 `fork_turns: "none"`，不复制父会话历史，仍不传 model。各任务消息完整给出规则路径、同一 manifest、读取命令、预算及只读边界；材料仍由 worker 自行读取。

先执行调用方给出的 read-skill 命令读取可信 SKILL.md，以及 write-source、write-temp 权限探测。prepared 模式仅开放 runtime-tmp 写入，源码必须保持只读；该权限适配不能表述为原始 read-only 全部通过。按其中流程执行一次完整审查。调用方追加了两种模式之一：

- native：在 fixture cwd 直接执行原版 build-review-manifest.mjs --base 命令，遵循其真实退出码。失败即停止演练，不自行切换 prepared。
- prepared：只读调用方预构建 manifest，明确报告“预构建快照适配演练，原版快照写入未通过”。跳过再次构建和删除调用方持有的 prepared 材料，其余六路、核查与报告遵循 SKILL。这只是所需最小适配的验证，不宣称未修改 skill 已完整通过。

六路 worker 各执行一次调用方给出的 read-<规则ID> 命令，再继续按自己的规则审查。native 模式下先将新 manifest 路径交给调用方指定的 select-manifest 命令；该命令若被 sandbox 拒绝，不重试，不改用旧快照，报告演练未完成。prepared 模式不调用 select-manifest。

严守六路独立、全量 patch、模型继承、10/30 分钟预算及确认停止后清理的约定。主会话核查候选、合并重复，只读材料，不做复现实验。能力不足如实报告，不由主会话代审，不启动独立 codex 进程。

六路结束后显式调用宿主状态接口（如 list_agents），供观察器核对真实终态。

最终只输出符合 schema 的 JSON：report 包含 SKILL 要求的 Standards、AI Review Rules、Summary，标明 native/prepared、任务身份、终态、真实耗时和清理状态。delivery_payload 原样包含指定 delivery-input.txt 的全部内容。不得将无效或缺失任务写成“未发现问题”。
