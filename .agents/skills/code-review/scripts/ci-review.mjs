#!/usr/bin/env node
import { queryRuntimeContract } from './ci-runtime-contract.mjs'
import { assessScheduling, EVIDENCE_VERSION, WORKER_CAPACITY } from './ci-scheduling.mjs'
// Trusted CI adapter. Review decisions remain in SKILL.md and its rule documents.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLI_VERSION, ACTION_SHA, RULES, canonical, inside, digest, json, save, rulePath,
  redact, scanRollouts, atomic, assessWorkers, readBundle } from './ci-runtime.mjs'

const ownSkill = dirname(dirname(fileURLToPath(import.meta.url)))
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '')
function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0 || result.error) throw new Error(`git ${args[0]} failed`)
  return result.stdout.trim()
}
function helper(repo, root, base) {
  const result = spawnSync(process.execPath, [join(root, 'skill/scripts/build-review-manifest.mjs'), '--base', base], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, TMPDIR: join(root, 'materials'), TMP: join(root, 'materials'), TEMP: join(root, 'materials') },
  })
  if (result.status !== 0 || result.error) throw new Error('trusted manifest helper failed; no fallback')
  return result.stdout.trim()
}
export function validateManifest(root, repo, manifestPath, base) {
  inside(join(root, 'materials'), manifestPath)
  const manifest = json(manifestPath)
  if (canonical(manifest.repositoryRoot) !== canonical(repo) || manifest.baseCommit !== base ||
      manifest.mode !== 'fixed-point' || manifest.textFileCount !== manifest.textFiles.length ||
      manifest.layers.length !== 4 || manifest.layers.map(l => l.kind).join(',') !== 'committed,staged,unstaged,untracked' ||
      manifest.layers.some(l => l.kind !== 'committed' && l.paths.length)) throw new Error('snapshot scope mismatch')
  inside(join(root, 'materials'), manifest.tempDirectory)
  for (const layer of manifest.layers) {
    inside(manifest.tempDirectory, layer.patchPath)
    for (const unit of layer.filePatches ?? []) inside(manifest.tempDirectory, unit.patchPath)
  }
  for (const path of manifest.standardSources) inside(repo, join(repo, path))
  return manifest
}
export function prepareReview(repo, root, base, head, skill = ownSkill) {
  repo = canonical(repo)
  if (!sha(base) || !sha(head)) throw new Error('fixed base/head SHA required')
  if (git(repo, ['rev-parse', 'HEAD']) !== head || git(repo, ['status', '--porcelain=v1', '--untracked-files=all'])) throw new Error('checkout is not clean fixed head')
  git(repo, ['cat-file', '-e', `${base}^{commit}`])
  // Resolve existing ancestors as well, so a symlink cannot place CI state in source.
  let ancestor = resolve(root)
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const physicalRoot = resolve(canonical(ancestor), relative(ancestor, resolve(root)))
  const outside = relative(repo, physicalRoot)
  if (!isAbsolute(outside) && !outside.split(sep).includes('..')) throw new Error('CI root must be outside the reviewed repository')
  root = physicalRoot
  if (existsSync(join(root, 'public'))) throw new Error('CI run directory must be fresh')
  mkdirSync(root, { recursive: true })
  if (canonical(skill) !== (existsSync(join(root, 'skill')) ? canonical(join(root, 'skill')) : '')) cpSync(skill, join(root, 'skill'), { recursive: true })
  for (const dir of ['private', 'public', 'controller', 'runtime-tmp', 'materials', 'codex-home']) mkdirSync(join(root, dir))
  const manifestPath = helper(repo, root, base)
  const manifest = validateManifest(root, repo, manifestPath, base)
  const catalog = ['standards', ...manifest.ruleCatalog.map(rule => rule.path.split('/').at(-1).replace(/\.md$/, ''))]
  if ([...catalog].sort().join(',') !== [...RULES].sort().join(',')) throw new Error('unexpected rule catalog; update the CI adapter explicitly')
  const config = {
    version: 1, evidenceVersion: EVIDENCE_VERSION, schedulingPolicy: 'required', workerCapacity: WORKER_CAPACITY, entrypoint: 'ci-review.mjs', base, head, mergeBase: git(repo, ['merge-base', base, head]),
    repositoryRoot: repo, root, manifestPath, reviewFiles: manifest.textFiles, textFileCount: manifest.textFileCount,
    cli: CLI_VERSION, action: ACTION_SHA, model: 'gpt-6.1-sol', effort: 'low', sandbox: 'temp-write-only',
    manifestHash: digest(readFileSync(manifestPath)), patchHash: digest(Buffer.concat(manifest.layers.map(l => readFileSync(l.patchPath)))),
    skillHash: digest(readFileSync(join(root, 'skill/SKILL.md'))),
    ruleHashes: Object.fromEntries(RULES.map(id => [id, digest(readFileSync(join(root, 'skill', rulePath(id))))])),
    run: process.env.GITHUB_RUN_ID ?? 'local', attempt: process.env.GITHUB_RUN_ATTEMPT ?? '1',
  }
  save(join(root, 'public/config.json'), config)
  cpSync(manifest.tempDirectory, join(root, 'public/snapshot'), { recursive: true })
  save(join(root, 'private/context.json'), { ...config, trustedSkill: join(root, 'skill/SKILL.md'), outputDirectory: join(root, 'runtime-tmp'), materialOwner: 'caller' })
  writeFileSync(join(root, 'codex-home/config.toml'), `project_doc_max_bytes = 0\n[agents]\nmax_concurrent_threads_per_session = ${WORKER_CAPACITY}\n[permissions.review-temp]\nextends = ":read-only"\n[permissions.review-temp.filesystem]\n${JSON.stringify(join(root, 'runtime-tmp').replaceAll('\\', '/'))} = "write"\n`)
  const command = id => `node ${join(root, 'skill/scripts/ci-review.mjs')} operation ${root} ${id}`
  writeFileSync(join(root, 'private/prompt.md'), readFileSync(join(root, 'skill/references/ci-review.md'), 'utf8') +
    `\n\n## 固定调用上下文\n${JSON.stringify({ context: join(root, 'private/context.json'), skill: join(root, 'skill/SKILL.md'), repositoryRoot: repo, manifestPath, base, head, controller: join(root, 'controller') }, null, 2)}\n\n` +
    ['read-skill', ...RULES.map(id => `read-${id}`)].map(id => `${id}: ${command(id)}`).join('\n') + '\n')
  if (!manifest.textFileCount) {
    save(join(root, 'public/events.json'), [])
    save(join(root, 'public/outcome.json'), { action: 'skipped' })
    save(join(root, 'public/final.json'), { status: 'complete', report: '## Standards\n无可审查文本变更。\n\n## AI Review Rules\n未启动规则任务。\n\n## Summary\n没有可审查文本变更。', tasks: [], findings: [] })
    writeFileSync(join(root, 'public/observer-complete'), 'no reviewable text\n')
  }
  return config
}

export function readMaterial(root, operation) {
  const config = json(join(root, 'public/config.json'))
  let evidence = { operation, status: 'PASS' }
  let output = ''
  try {
    const context = json(join(root, 'private/context.json'))
    if (context.evidenceVersion !== EVIDENCE_VERSION || context.schedulingPolicy !== 'required' || config.evidenceVersion !== EVIDENCE_VERSION || config.schedulingPolicy !== 'required' || context.version !== 1 || context.materialOwner !== 'caller' ||
        ['workerCapacity', 'base', 'head', 'manifestPath', 'repositoryRoot', 'manifestHash', 'patchHash'].some(key => context[key] !== config[key]) ||
        canonical(context.trustedSkill) !== canonical(join(root, 'skill/SKILL.md')) ||
        canonical(context.outputDirectory) !== canonical(join(root, 'runtime-tmp'))) throw new Error('invalid CI context')
    if (operation === 'read-skill') {
      const content = readFileSync(join(root, 'skill/SKILL.md'))
      evidence.hash = digest(content)
      if (evidence.hash !== config.skillHash) throw new Error('skill changed')
      output = content.toString()
    } else {
      const rule = operation.slice(5)
      if (operation !== `read-${rule}` || !RULES.includes(rule)) throw new Error('unknown operation')
      validateManifest(root, config.repositoryRoot, config.manifestPath, config.base)
      const { content, ...hashes } = readBundle(root, config.repositoryRoot, config.manifestPath, rule)
      evidence = { ...evidence, ...hashes }
      if (evidence.manifestHash !== config.manifestHash || evidence.patchHash !== config.patchHash || evidence.ruleHash !== config.ruleHashes[rule]) throw new Error('material changed')
      output = content
    }
  } catch { evidence = { operation, status: 'FAIL', failure: 'operation_failed' } }
  process.stdout.write(output + '\nCAPABILITY_EVIDENCE ' + JSON.stringify(evidence) + '\n')
  return evidence
}

export function validateResult(value, config) {
  if (!value || !['complete', 'incomplete'].includes(value.status) || typeof value.report !== 'string' || !value.report.trim() ||
      !['Standards', 'AI Review Rules', 'Summary'].every(s => value.report.includes(s)) || !Array.isArray(value.tasks) || !Array.isArray(value.findings)) throw new Error('invalid final result')
  for (const task of value.tasks) if (!RULES.includes(task.rule) || typeof task.agent !== 'string' || typeof task.status !== 'string') throw new Error('invalid task result')
  for (const finding of value.findings) {
    if (!['Critical', 'Major', 'Minor'].includes(finding.severity) || !config.reviewFiles.includes(finding.file) ||
        !Number.isSafeInteger(finding.line) || finding.line < 1 || !['title', 'evidence', 'trigger', 'impact'].every(key => typeof finding[key] === 'string' && finding[key].trim()) ||
        !value.report.includes(finding.file) || !value.report.includes(finding.severity)) throw new Error('invalid finding')
  }
  return value
}
export async function observeReview(root) {
  const deadline = Date.now() + 45 * 60 * 1000
  while (Date.now() < deadline) {
    const { events, inventory } = scanRollouts(root)
    atomic(join(root, 'public/events.json'), events)
    atomic(join(root, 'public/event-types.json'), inventory)
    if (existsSync(join(root, 'private/outcome.json'))) {
      const value = json(join(root, 'private/outcome.json')).action
      save(join(root, 'public/outcome.json'), { action: ['success', 'failure', 'cancelled', 'skipped'].includes(value) ? value : 'unknown' })
      try {
        const config = json(join(root, 'public/config.json'))
        const final = validateResult(json(join(root, 'private/final.json')), config)
        // Only the explicitly requested final report is published, never raw rollout output.
        save(join(root, 'public/final.json'), JSON.parse(redact(JSON.stringify(final))))
      } catch { save(join(root, 'public/invalid-output.json'), { status: 'incomplete' }) }
      writeFileSync(join(root, 'public/observer-complete'), 'complete\n')
      return
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

export function assessReview(input, output, expected = {}) {
  mkdirSync(output, { recursive: true })
  const reasons = []
  let scheduling = { status: 'UNVERIFIED', reasons: ['EVIDENCE_MISSING'] }
  let config, final, workers = [], outcome = 'unknown', complete = false
  try {
    config = json(join(input, 'config.json'))
    for (const key of ['base', 'head', 'run', 'attempt']) if (expected[key] && String(config[key]) !== String(expected[key])) throw new Error(`mismatched ${key}`)
    if (config.evidenceVersion !== EVIDENCE_VERSION || config.schedulingPolicy !== 'required') reasons.push('strict scheduling policy missing or downgraded')
    final = validateResult(json(join(input, 'final.json')), config)
    outcome = json(join(input, 'outcome.json')).action
    if (!config.textFileCount) {
      scheduling = { status: 'NOT_APPLICABLE', reasons: [], configuration: { policy: reasons.length ? 'UNVERIFIED' : 'PASS' } }
      complete = reasons.length === 0 && outcome === 'skipped' && final.status === 'complete' && !final.tasks.length && !final.findings.length
    } else {
      const events = json(join(input, 'events.json'))
      const analysis = assessWorkers(events, config)
      workers = analysis.workers
      const roots = events.filter(e => e.type === 'session_meta' && !e.parent)
      const environment = events.some(e => e.type === 'session_meta' && e.cli === CLI_VERSION) && events.some(e =>
        e.type === 'turn_context' && roots.some(r => r.thread === e.thread) && e.model === config.model && ['read-only', 'workspace-write'].includes(e.sandbox))
      const skill = events.some(e => e.type === 'operation' && e.operation === 'read-skill' && roots.some(r => r.thread === e.thread) && e.status === 'PASS' && e.exitCode === 0 && e.hash === config.skillHash)
      const sameMaterials = workers.every(w => w.reads.length && w.reads.every(r => r.manifestHash === config.manifestHash))
      const roster = workers.every(w => final.tasks.filter(t => t.rule === w.rule && [w.id, `/root/${w.rule}`].includes(t.agent) && t.status === 'completed').length === 1) &&
        final.tasks.every(t => t.status === 'completed')
      const contract = existsSync(join(input, 'runtime-contract.json')) ? json(join(input, 'runtime-contract.json')) : null
      scheduling = assessScheduling(events, config, contract)
      const terminals = analysis.spawnEvents.every(spawn => events.some(e =>
        e.type === 'worker_turn_completed' && e.thread === spawn.new_thread_id || e.type === 'host_status' && e.agents?.some(a => a.path === spawn.path && ['completed', 'interrupted', 'errored', 'shutdown'].includes(a.status))))
      if (!environment) reasons.push('环境或固定模型证据不完整')
      if (!skill) reasons.push('可信 skill 读取证据缺失')
      if (new Set(workers.map(w => w.id).filter(Boolean)).size !== RULES.length || !sameMaterials || !roster) reasons.push('六路身份、报告名单或完整材料证据不完整')
      if (!workers.every(w => w.status === 'completed' && w.modelConfirmed)) reasons.push('必要任务未完成、输出无效或模型继承未证实')
      if (scheduling.status !== 'PASS') reasons.push(`调度 ${scheduling.status}: ${scheduling.reasons.join(', ')}`)
      if (!terminals) reasons.push('存在未确认停止的派生任务')
      if (events.some(e => e.type === 'operation' && (e.status !== 'PASS' || e.exitCode !== 0))) reasons.push('材料读取失败')
      if (outcome !== 'success' || final.status !== 'complete') reasons.push('调用失败或主会话报告未完成')
      complete = reasons.length === 0
    }
  } catch (error) { reasons.push(redact(error.message)); complete = false }
  if (!complete && !reasons.length) reasons.push('审查未完成')
  const findings = final?.findings ?? []
  const counts = Object.fromEntries(['Critical', 'Major', 'Minor'].map(s => [s, findings.filter(f => f.severity === s).length]))
  const metadata = { status: complete ? 'complete' : 'incomplete', base: expected.base ?? config?.base, head: expected.head ?? config?.head,
    run: expected.run ?? config?.run, attempt: expected.attempt ?? config?.attempt, counts, reasons, workers, outcome, scheduling, configuration: scheduling.configuration ?? null }
  const header = `审查 head：${metadata.head ?? '未知'}\n\n可信 skill 来源 base：${metadata.base ?? '未知'}\n\nCLI：${CLI_VERSION}；模型：gpt-6.1-sol / low\n\n整体状态：${complete ? '完成' : '未完成'}\n\n`
  const schedulingReport = `调度验收：${config?.textFileCount === 0 ? 'N/A（无可审查文本）' : scheduling.status}；原因：${scheduling.reasons.join(', ') || '无'}\n\n`
  const report = header + schedulingReport + (final?.report ?? '## Standards\n审查未完成。\n\n## AI Review Rules\n未取得有效报告。\n\n## Summary\n执行失败，不能判定未发现问题。') +
    (reasons.length ? '\n\n未完成原因：\n' + reasons.map(r => `- ${r}`).join('\n') : '')
  save(join(output, 'result.json'), metadata)
  writeFileSync(join(output, 'report.md'), report + '\n')
  return metadata
}

export function commentBody(result, report, runUrl, artifactUrl) {
  const stamp = `<!-- codex-pr-review -->\n<!-- codex-run ${result.head} ${result.run} ${result.attempt} -->`
  const full = `${stamp}\n\n## Codex PR 审查\n\n${report}\n\n[完整报告与证据](${artifactUrl}) · [Actions](${runUrl})`
  if (Array.from(full).length <= 50000) return full
  const tasks = (result.workers ?? []).map(w => `${w.rule}: ${w.status}`).join('；') || '没有规则任务证据'
  return `${stamp}\n\n## Codex PR 审查\n\n审查 head：${result.head}\n\n整体状态：${result.status === 'complete' ? '完成' : '未完成'}\n\n调度：${result.scheduling?.status ?? 'UNVERIFIED'}；${result.scheduling?.reasons?.join(', ') ?? '证据不可用'}\n\n任务：${tasks}\n\nCritical ${result.counts.Critical} / Major ${result.counts.Major} / Minor ${result.counts.Minor}\n\n报告较长，全部 findings 保存在[完整报告与证据](${artifactUrl})中。\n\n[Actions](${runUrl})`
}
export function newerComment(body, result) {
  const stamp = body?.match(/<!-- codex-run ([a-f0-9]{40}) (\d+) (\d+) -->/)
  if (!stamp || stamp[1] !== result.head) return false
  return BigInt(stamp[2]) > BigInt(result.run) || stamp[2] === String(result.run) && BigInt(stamp[3]) > BigInt(result.attempt)
}
export async function publish(github, context, result, report, artifactUrl) {
  const { owner, repo } = context.repo
  const number = context.payload.pull_request.number
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 })
  const existing = comments.find(c => c.user?.login === 'github-actions[bot]' && c.user?.type === 'Bot' && c.body?.startsWith('<!-- codex-pr-review -->'))
  if (existing && newerComment(existing.body, result)) return 'newer-result'
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number })
  if (pr.state !== 'open' || pr.draft || pr.head.sha !== result.head) return 'stale'
  const url = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`
  const body = commentBody(result, report, url, artifactUrl ?? url)
  if (existing) await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body })
  else await github.rest.issues.createComment({ owner, repo, issue_number: number, body })
  return 'published'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, root, ...args] = process.argv.slice(2)
  if (command === 'prepare') {
    const config = prepareReview(resolve(args[0]), resolve(root), args[1], args[2])
    if (config.textFileCount) {
      const child = spawn(process.execPath, [join(root, 'skill/scripts/ci-review.mjs'), 'observe', root], { detached: true, stdio: 'ignore', env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } })
      child.unref()
      if ((await queryRuntimeContract(resolve(root))).status !== 'PASS') throw new Error('Pinned runtime contract could not be verified; no model call allowed')
    }
    if (process.env.GITHUB_OUTPUT) {
      const { appendFileSync } = await import('node:fs')
      appendFileSync(process.env.GITHUB_OUTPUT, `has_text=${config.textFileCount > 0}\n`)
    }
  } else if (command === 'operation') {
    if (readMaterial(resolve(root), args[0]).status !== 'PASS') process.exitCode = 1
  } else if (command === 'observe') await observeReview(resolve(root))
  else if (command === 'assess') {
    const result = assessReview(resolve(root), resolve(args[0]), { base: process.env.REVIEW_BASE_SHA, head: process.env.REVIEW_HEAD_SHA, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT })
    if (result.status !== 'complete') process.exitCode = 1
  } else throw new Error('usage: ci-review.mjs prepare|operation|observe|assess <root> ...')
}
