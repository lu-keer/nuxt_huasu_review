// Shared CI mechanics; no review rules or model executor live here.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
export const CLI_VERSION = '0.167.1'
export const ACTION_SHA = '1d82a3dba7c7988ec71ecae1ed5b8e8db96495c5'
export const RULES = ['standards', 'architect', 'devops', 'product_contract', 'runtime_performance', 'security']
export const digest = value => createHash('sha256').update(value).digest('hex')
export const json = path => JSON.parse(readFileSync(path, 'utf8'))
export const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
export const rulePath = id => id === 'standards' ? 'references/standards.md' : `references/ai_review_rules/${id}.md`
export const statusName = value => typeof value === 'string' ? value : Object.keys(value ?? {})[0] ?? 'unknown'
export function validOutput(status, files = []) {
  const output = status?.completed
  return typeof output === 'string' && (output.trim() === 'NO_FINDINGS' ||
    /Critical|Major|Minor/.test(output) && files.some(file => output.includes(file)) && /\d+/.test(output))
}
const outputFormat = output => {
  if (typeof output !== 'string' || !output.trim()) return 'missing'
  if (output.trim() === 'NO_FINDINGS') return 'no_findings'
  try { JSON.parse(output); return 'structured' } catch {}
  if (/\bNO_FINDINGS\b/.test(output)) return 'no_findings_with_extra_text'
  return 'findings_or_unrecognized'
}
export const canonical = path => {
  const actual = realpathSync.native(path)
  return process.platform === 'win32' ? actual.toLowerCase() : actual
}
export function inside(root, candidate) {
  const actual = canonical(candidate)
  const rel = relative(canonical(root), actual)
  if (!rel || isAbsolute(rel) || rel.split(sep).includes('..')) throw new Error('path outside CI root')
  return actual
}
export const redact = text => text.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '[REDACTED]')
  .replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, '[REDACTED]')
export function readBundle(root, repositoryRoot, manifestPath, rule) {
  const manifest = json(inside(root, manifestPath))
  const patches = manifest.layers.map(layer => readFileSync(inside(root, layer.patchPath)))
  const content = readFileSync(join(root, 'skill', rulePath(rule)))
  const standards = rule === 'standards' ? manifest.standardSources.map(path =>
    readFileSync(inside(repositoryRoot, join(repositoryRoot, path)), 'utf8')).join('\n') : ''
  return { manifestHash: digest(readFileSync(manifestPath)), patchHash: digest(Buffer.concat(patches)), ruleHash: digest(content),
    content: [content.toString(), readFileSync(manifestPath, 'utf8'), ...patches.map(p => p.toString()), standards].join('\n') }
}
// Do not publish arbitrary log text, command strings, prompts, env, tool output or agent messages.
export function projectRecord(record, thread, root, calls = new Map()) {
  const configPath = join(root, 'public/config.json')
  const config = existsSync(configPath) ? json(configPath) : {}
  const acceptsOutput = status => validOutput(status, config.reviewFiles)
  const p = record.payload ?? {}
  const base = { timestamp: record.timestamp, thread, order: record.ordinal }
  if (record.type === 'response_item' && p.type === 'function_call') {
    try { calls.set(`${thread}:${p.call_id}`, { name: p.name, cmd: JSON.parse(p.arguments).cmd }) } catch { /* invalid args */ }
    const tool = p.name?.split('.').at(-1)
    if (['wait', 'wait_agent', 'list_agents'].includes(tool)) return { ...base, type: 'tool_request', tool, call_id: p.call_id }
  }
  if (record.type === 'response_item' && p.type === 'function_call_output') {
    const call = calls.get(`${thread}:${p.call_id}`)
    if (!call) return null
    return projectRecord({ ...record, type: 'event_msg', payload: { type: 'item_completed', item: {
      type: 'FunctionCallOutput', id: p.call_id, name: call.name, output: p.output,
    } } }, thread, root, calls)
  }
  if (record.type === 'session_meta') return { ...base, type: 'session_meta', thread: p.id, parent: p.parent_thread_id ?? p.source?.subagent?.thread_spawn?.parent_thread_id, path: p.agent_path ?? p.source?.subagent?.thread_spawn?.agent_path, cli: p.cli_version }
  if (record.type === 'turn_context') return { ...base, type: 'turn_context', model: p.model, effort: p.effort ?? p.reasoning_effort, sandbox: p.sandbox_policy?.type }
  // 0.167.1 persists completed typed items, not the transient exec/collab events.
  if (record.type === 'event_msg' && p.type === 'item_completed') {
    const item = p.item ?? {}
    if (item.type === 'CommandExecution') return projectRecord({ ...record, payload: { ...item, type: 'exec_command_end' } }, thread, root)
    if (item.type === 'FunctionCallOutput') {
      const output = typeof item.output === 'string' ? item.output : Array.isArray(item.output) ? item.output.filter(x => x.type === 'input_text').map(x => x.text).join('\n') : ''
      if (/(?:^|\.)spawn_agent$/.test(item.name)) {
        try {
          const parsed = JSON.parse(output)
          const path = parsed.task_name ?? parsed.agent_name
          const id = parsed.agent_id ?? parsed.thread_id
          if (typeof path !== 'string' && typeof id !== 'string') return null
          return { ...base, type: 'tool_return', tool: 'spawn_agent', call_id: item.id,
            ...(/^\/root\/[a-z0-9_]+$/i.test(path ?? '') ? { path } : {}),
            ...(typeof id === 'string' && /^[a-z0-9-]+$/i.test(id) ? { id } : {}) }
        } catch { return null }
      }
      if (/(?:^|\.)(wait|wait_agent)$/.test(item.name)) return { ...base, type: 'tool_return', tool: item.name.split('.').at(-1), call_id: item.id }
      if (/(?:^|\.)list_agents$/.test(item.name)) {
        try {
          const parsed = JSON.parse(output)
          return { ...base, type: 'host_status', call_id: item.id, agents: (parsed.agents ?? []).filter(a => /^\/root\/[a-z0-9_]+$/i.test(a.agent_name)).map(a => ({ path: a.agent_name, status: statusName(a.agent_status), valid: acceptsOutput(a.agent_status) })) }
        } catch { return null }
      }
      // Some history modes persist exec output only as a typed function output.
      // Do not infer command identity from model-authored messages.
      if (/(?:^|\.)exec_command$/.test(item.name)) {
        const match = output.match(/CAPABILITY_EVIDENCE (\{[^\n]+\})/)
        if (!match) return null
        try {
          const evidence = JSON.parse(match[1])
          const cmd = calls.get(`${thread}:${item.id}`)?.cmd
          const exit = output.match(/Process exited with code (\d+)/)
          if (!exit) return null
          return projectRecord({ ...record, payload: { type: 'exec_command_end', command: [cmd], exit_code: Number(exit[1]), aggregated_output: `CAPABILITY_EVIDENCE ${match[1]}` } }, thread, root, calls)
        } catch { return null }
      }
    }
    if (item.type === 'SubAgentActivity') return { ...base, type: 'agent_activity', id: item.agent_thread_id, path: item.agent_path, kind: item.kind, model: item.model, call_id: item.id }
    if (item.type === 'CollabAgentToolCall') {
      const types = { spawn_agent: 'collab_agent_spawn_end', wait: 'collab_waiting_end', close_agent: 'collab_close_end' }
      if (!types[item.tool]) return null
      return projectRecord({ ...record, payload: { ...item, type: types[item.tool], call_id: item.id,
        returned: item.status === 'completed',
        new_thread_id: item.receiver_thread_ids?.[0], receiver_thread_id: item.receiver_thread_ids?.[0], statuses: item.agents_states } }, thread, root)
    }
    return null
  }
  if (record.type === 'response_item' && p.type === 'function_call' && /(?:^|\.)spawn_agent$/.test(p.name)) {
    try {
      const args = JSON.parse(p.arguments)
      return { ...base, type: 'spawn_arguments', call_id: p.call_id, overridesModel: Object.hasOwn(args, 'model'),
        overridesEffort: Object.hasOwn(args, 'reasoning_effort'), forkTurns: ['none', 'all'].includes(args.fork_turns) ? args.fork_turns : null,
        task: /^[a-z0-9_]+$/i.test(args.task_name ?? '') ? args.task_name : undefined }
    } catch { return null }
  }
  if (record.type !== 'event_msg') return null
  if (p.type === 'sub_agent_activity') return { ...base, type: 'agent_activity', id: p.agent_thread_id, path: p.agent_path, kind: p.kind, model: p.model, call_id: p.event_id }
  if (['task_started', 'turn_started', 'task_complete', 'turn_complete'].includes(p.type)) {
    return { ...base, type: p.type.endsWith('started') ? 'worker_turn_started' : 'worker_turn_completed',
      ...(p.type.endsWith('started') ? {} : { valid: acceptsOutput({ completed: p.last_agent_message }), outputFormat: outputFormat(p.last_agent_message) }) }
  }
  if (/^collab_(agent_spawn|waiting|close|agent_interaction)_(begin|end)$/.test(p.type)) {
    const out = { ...base, type: p.type }
    if (p.returned === true) out.returned = true
    for (const key of ['call_id', 'sender_thread_id', 'receiver_thread_id', 'new_thread_id', 'model', 'reasoning_effort']) {
      if (typeof p[key] === 'string') out[key] = p[key]
    }
    if (p.status !== undefined) out.status = statusName(p.status)
    const statuses = p.statuses ?? (p.agent_statuses && Object.fromEntries(p.agent_statuses.map(a => [a.thread_id, a.status])))
    if (statuses) {
      out.statuses = Object.fromEntries(Object.entries(statuses).map(([id, value]) => [id, statusName(value)]))
      out.valid_outputs = Object.fromEntries(Object.entries(statuses).map(([id, value]) => [id, acceptsOutput(value)]))
    }
    return out
  }
  if (p.type === 'exec_command_end') {
    const command = p.command?.at(-1)
    const prefix = `node ${join(root, 'skill/scripts', config.entrypoint ?? 'ci-review.mjs')} operation ${root} `
    if (typeof command !== 'string' || !command.startsWith(prefix)) return null
    const op = command.slice(prefix.length)
    if (!['read-skill', ...RULES.map(id => `read-${id}`)].includes(op)) return null
    const line = p.aggregated_output?.split('\n').find(line => line.startsWith('CAPABILITY_EVIDENCE '))
    let evidence
    try { evidence = JSON.parse(line.slice('CAPABILITY_EVIDENCE '.length)) } catch { return null }
    if (evidence.operation !== op || !['PASS', 'FAIL'].includes(evidence.status)) return null
    const safe = { ...base, type: 'operation', operation: op, status: evidence.status, exitCode: p.exit_code }
    if (['permission_denied', 'operation_failed'].includes(evidence.failure)) safe.failure = evidence.failure
    if (['filesystem_permission_denied', 'snapshot_scope_mismatch', 'helper_failed_unknown'].includes(evidence.diagnostic)) safe.diagnostic = evidence.diagnostic
    for (const key of ['hash', 'manifestHash', 'ruleHash', 'patchHash']) if (/^[a-f0-9]{64}$/.test(evidence[key])) safe[key] = evidence[key]
    return safe
  }
  return null
}

function rolloutFiles(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? rolloutFiles(path) : entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  })
}

export function atomic(path, value) {
  const temporary = path + '.next'
  save(temporary, value)
  renameSync(temporary, path)
}


export function scanRollouts(root) {
const events = []
const inventory = {}
for (const file of rolloutFiles(join(root, 'codex-home'))) {
  let thread
  const calls = new Map()
  const records = readFileSync(file, 'utf8').split('\n').flatMap(line => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  const meta = records.find(r => r.type === 'session_meta')
  const inherited = records.some(r => r.type === 'session_meta' && r.payload.id !== meta?.payload.id)
  const boundary = meta?.payload.subagent_history_start_ordinal
  for (const [order, raw] of records.entries()) {
    const record = { ...raw, ordinal: Number.isSafeInteger(raw.ordinal) ? raw.ordinal : order }
    try {
      const kind = `${record.type}/${record.payload?.type ?? ''}/${record.payload?.item?.type ?? ''}`
      inventory[kind] = (inventory[kind] ?? 0) + 1
      // Forked rollouts embed parent metadata/history. The file's first
      // metadata identifies its owner; embedded metadata must not reassign it.
      if (record.type === 'session_meta') {
        if (thread) continue
        thread = record.payload.id
      } else if (Number.isSafeInteger(boundary)) {
        if (!Number.isSafeInteger(raw.ordinal) || raw.ordinal < boundary) continue
      } else if (inherited) {
        // Legacy physical forks lack a reliable ordinal boundary. Fail closed
        // instead of assigning inherited parent activity to this worker.
        continue
      }
      const projected = projectRecord(record, thread, root, calls)
      if (projected) events.push(projected)
    } catch { /* trailing partial record: next scan will retry */ }
  }
}
  return { events, inventory }
}

export function assessWorkers(events, config) {
  const opEvents = name => events.filter(e => e.type === 'operation' && e.operation === name)
  const activities = events.filter(e => e.type === 'agent_activity')
  // V2 exposes thread identity/model in activity and real status via list_agents.
  // Match through runtime-owned path/ID, never through the final model report.
  const spawnRecords = [...events.filter(e => e.type === 'collab_agent_spawn_end' && e.new_thread_id),
    ...activities.filter(e => e.kind === 'started').map(e => ({ ...e, new_thread_id: e.id })),
    ...events.filter(e => e.type === 'session_meta' && e.parent && e.path).flatMap(e => {
      const args = events.find(a => a.type === 'spawn_arguments' && a.thread === e.parent && e.path === `/root/${a.task}`)
      if (!args) return []
      const context = events.find(a => a.type === 'turn_context' && a.thread === e.thread)
      return [{ ...e, new_thread_id: e.thread, call_id: args.call_id, model: context?.model }]
    })]
  // Different durable/legacy sources can describe the same worker. Merge by
  // runtime identity so an earlier partial spawn cannot hide its V2 path.
  const spawnEvents = [...new Set(spawnRecords.map(e => e.new_thread_id))].map(id =>
    Object.assign({}, ...spawnRecords.filter(e => e.new_thread_id === id)
      .map(e => Object.fromEntries(Object.entries(e).filter(([, value]) => value !== undefined && value !== null)))))
  const workers = RULES.map(rule => {
    const reads = opEvents(`read-${rule}`).filter(e => e.status === 'PASS' && e.exitCode === 0 &&
      /^[a-f0-9]{64}$/.test(e.manifestHash) && e.patchHash === config.patchHash && e.ruleHash === config.ruleHashes?.[rule])
    const spawn = spawnEvents.find(e => reads.some(read => read.thread === e.new_thread_id))
    const statuses = spawn ? events.flatMap(e => [
      ...(e.statuses?.[spawn.new_thread_id] ? [{ status: e.statuses[spawn.new_thread_id], timestamp: e.timestamp, valid: e.valid_outputs?.[spawn.new_thread_id] === true }] : []),
      ...(e.receiver_thread_id === spawn.new_thread_id && e.status ? [{ status: e.status, timestamp: e.timestamp }] : []),
      ...(e.type === 'host_status' ? (e.agents ?? []).filter(a => a.path === spawn.path).map(a => ({ ...a, timestamp: e.timestamp })) : []),
      ...(e.type === 'worker_turn_completed' && e.thread === spawn.new_thread_id ? [{ status: 'completed', valid: e.valid === true, timestamp: e.timestamp }] : []),
    ]) : []
    const end = statuses.find(e => e.status === 'completed' && e.valid)
    const context = spawn ? events.filter(e => e.type === 'turn_context' && e.thread === spawn.new_thread_id) : []
    const started = spawn ? events.find(e => e.type === 'worker_turn_started' && e.thread === spawn.new_thread_id) : null
    const completed = spawn ? events.find(e => e.type === 'worker_turn_completed' && e.thread === spawn.new_thread_id) : null
    return { rule, id: spawn?.new_thread_id, spawn: spawn?.timestamp, end: end?.timestamp,
      runningFrom: started?.timestamp, runningUntil: completed?.timestamp,
      status: end ? 'completed' : statuses.at(-1)?.status === 'completed' ? 'completed / invalid_output' : statuses.at(-1)?.status ?? 'unknown', model: spawn?.model,
      outputFormat: completed?.outputFormat ?? 'unavailable',
      modelConfirmed: spawn?.model === config.model && context.length > 0 && context.every(e => e.model === config.model) &&
        events.some(e => e.type === 'spawn_arguments' && e.call_id === spawn?.call_id && e.overridesModel === false),
      reads, duration: '不可用' }
  })
  return { workers, spawnEvents }
}
