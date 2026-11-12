import { RULES } from './ci-runtime.mjs'

export const RESULT_VERSION = 2
export const COMMENT_LIMIT = 50000
export const SUMMARY_BYTES = 900000
export const SUMMARY_PARTS = 20
const length = value => Array.from(value).length
export const escapeText = value => String(value ?? '未知').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}[\]()#+.!|~\-]/g, '\\$&').replace(/\r?\n/g, ' ')
const statusText = status => ({ completed: '已完成', errored: '失败', interrupted: '已取消', shutdown: '已停止', timeout: '超时', unknown: '终态未确认' })[status] ?? `未完成（${escapeText(status)}）`
const sorted = result => [...(result.findings ?? [])].sort((a, b) => ['Critical', 'Major', 'Minor'].indexOf(a.severity) - ['Critical', 'Major', 'Minor'].indexOf(b.severity) || a.file.localeCompare(b.file, 'en') || a.line - b.line).map((f, i) => ({ ...f, id: `F${i + 1}` }))
function location(f, result, repoUrl) {
  const label = escapeText(`${f.file}:${f.line}`)
  const count = result.locations?.[f.file]?.[f.side]
  const commit = f.side === 'base' ? result.base : result.head
  return Number.isSafeInteger(count) && f.line <= count && /^[a-f0-9]{40}$/.test(commit ?? '')
    ? `[${label}](${repoUrl}/blob/${commit}/${f.file.split('/').map(encodeURIComponent).join('/')}#L${f.line})`
    : `${label}（位置未验证）`
}
export function renderReview(result, repoUrl, compact = false, indexCount = Infinity) {
  const findings = sorted(result), empty = result.textFileCount === 0
  const worker = rule => result.workers?.find(w => w.rule === rule)
  const covered = rule => worker(rule)?.reads?.some(r => r.manifestHash === result.manifestHash && r.status === 'PASS')
  const state = rule => empty ? '未运行' : statusText(worker(rule)?.status ?? 'unknown')
  const ids = rule => findings.filter(f => f.sources.includes(rule)).map(f => f.id).join('、')
  const outcome = rule => empty ? '无可审查文本' : ids(rule) || (worker(rule)?.status === 'completed' && covered(rule) ? '未发现问题' : '未取得完整核实结果')
  const detail = f => `- **${f.id} · ${f.severity}：${escapeText(f.title)}** — ${location(f, result, repoUrl)}\n\n  触发条件：${escapeText(f.trigger)}\n  代码依据：${escapeText(f.evidence)}\n  影响：${escapeText(f.impact)}`
  const scope = rule => covered(rule) ? `覆盖全部 ${result.textFileCount} 个可审查文本文件` : '完整覆盖未确认'
  const parts = ['### Standards', empty ? '无可审查文本变更，未启动 Standards 审查。' : `${state('standards')}，${scope('standards')}；${outcome('standards')}。`]
  if (!compact) parts.push(...findings.filter(f => f.sources.includes('standards')).map(detail))
  parts.push('### AI Review Rules', '规则路径相对于 `.agents/skills/code-review/`；各项覆盖范围按实际读取证据确认。', '| 规则路径 | 实际状态 | 核实结果与覆盖 |\n|---|---|---|\n' + RULES.filter(r => r !== 'standards').map(r => `| \`references/ai_review_rules/${r}.md\` | ${state(r)} | ${outcome(r)}${empty ? '' : `；${scope(r)}`} |`).join('\n'))
  if (!compact) parts.push(...findings.filter(f => !f.sources.includes('standards')).map(detail))
  parts.push('### Summary')
  if (empty && result.status === 'complete') parts.push('本次范围检查完成，没有可审查文本变更，未调用模型或启动 worker。未产生审查问题；剔除及合并不适用。')
  else {
    parts.push(result.status === 'complete' ? `六项必要审查全部完成。${findings.length ? '' : '未发现高置信度问题。'}` : `审查未完成：${(result.reasons ?? []).map(escapeText).join('；') || '证据不足'}。当前已核实 ${findings.length} 项问题，不能据此判定未发现其他问题。`)
    parts.push(`最终保留 ${findings.length} 项问题：Critical ${result.counts.Critical} / Major ${result.counts.Major} / Minor ${result.counts.Minor}；最高严重程度：${findings[0]?.severity ?? '无'}。\n\n剔除候选：${result.statistics?.discarded ?? '未提供'}；合并重复报告：${result.statistics?.merged ?? '未提供'}。`)
  }
  if (compact) parts.push(`问题索引（已展示 ${Math.min(indexCount, findings.length)}/${findings.length}，未展示 ${Math.max(0, findings.length - indexCount)}）：`, ...findings.slice(0, indexCount).map(f => `- **${f.id} · ${f.severity}：${escapeText(f.title)}** — ${location(f, result, repoUrl)}`))
  parts.push('未修改代码，未运行项目构建、测试或复现实验。worker 实际耗时及独立墙钟等待时长不可用，未作估算。', `<details>\n<summary>审查范围与执行证据</summary>\n\n- 可审查文本文件：${result.textFileCount ?? '未知'}。\n- base：${escapeText(result.base)}；head：${escapeText(result.head)}。\n- run：${escapeText(result.run)}；attempt：${escapeText(result.attempt)}。\n- CLI：${escapeText(result.cli)}；模型：${escapeText(result.model)} / ${escapeText(result.effort)}。\n- 严格调度：${escapeText(result.scheduling?.status)}。\n- 任务身份、读取记录及材料位置保存在 Actions 执行证据中；预构建材料由调用方持有，模型未执行清理。\n\n</details>`)
  return parts.filter(Boolean).join('\n\n')
}
export function makeComment(result, repoUrl, runUrl, documentUrl = null) {
  const stamp = `<!-- codex-pr-review -->\n<!-- codex-run ${result.head} ${result.run} ${result.attempt} -->\n\n`
  const footer = `\n\n[查看 Actions](${runUrl})`
  const full = stamp + renderReview(result, repoUrl) + footer
  if (length(full) <= COMMENT_LIMIT) return { body: full, summary: null }
  const summary = renderReview(result, repoUrl)
  let count = sorted(result).length
  const ending = documentUrl ? `\n\n详细证据见[查看详细审查文档](${documentUrl})。` : '\n\n详细审查文档交付失败：没有可验证的在线入口；请查看 Actions 诊断。'
  let body
  do { body = stamp + renderReview(result, repoUrl, true, count) + ending + footer; if (length(body) <= COMMENT_LIMIT) break; count-- } while (count >= 0)
  if (count < 0) throw new Error('comment metadata exceeds budget')
  return { body, summary }
}
export function splitSummary(markdown) {
  const chunks = []; let current = ''
  for (const paragraph of markdown.split('\n\n')) {
    if (Buffer.byteLength(paragraph) > SUMMARY_BYTES) throw new Error('summary paragraph exceeds step budget')
    const next = current ? current + '\n\n' + paragraph : paragraph
    if (Buffer.byteLength(next) > SUMMARY_BYTES) { chunks.push(current); current = paragraph } else current = next
  }
  if (current) chunks.push(current)
  if (chunks.length > SUMMARY_PARTS) throw new Error('summary exceeds 20 step budget')
  return chunks
}
