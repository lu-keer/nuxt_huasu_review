---
name: setup-huasu
description: 为当前项目写入华速协作规范：AGENTS.md、.gitignore tmp/；用于项目初始化或补齐。
---

# 华速协作规范初始化

在目标项目根目录创建或更新 `AGENTS.md` 与 `.gitignore`，使用 `apply_patch` 完成修改。保留项目其他内容；已有“全程中文交流”标题时保留，缺失时追加，不重复写入。结束前核对该标题只有一组，且 `tmp/` 已被忽略。

不写入或恢复本地自动 Code Review、自动触发或桌面宿主自动调度要求。代码审查由项目的 GitHub Actions 调用 `code-review` skill；保留 skill 与显式手动调用能力，不修改审查规则、依赖或锁文件。

## 1. `AGENTS.md`

```markdown
## 全程中文交流
```

## 2. `.gitignore`

若项目根目录的 `tmp/` 尚未被忽略，追加以下内容；已有等效忽略规则时不重复追加，已有取消忽略规则时调整相关规则使其生效：

```
# code-review 临时产物
tmp/
```
