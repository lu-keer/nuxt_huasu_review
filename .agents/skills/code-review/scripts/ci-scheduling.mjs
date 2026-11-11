// Runtime evidence only: never infer capacity or tool returns from model prose.
export const EVIDENCE_VERSION = 2
export const WORKER_CAPACITY = 2
export const RULE_IDS = ['standards', 'architect', 'devops', 'product_contract', 'runtime_performance', 'security']
const terminal = new Set(['completed', 'interrupted', 'errored', 'shutdown', 'cancelled'])
const time = event => Date.parse(event?.timestamp)

export function assessScheduling(events, config, contract, rules = RULE_IDS) {
  const reasons = [], violations = [], refs = []
  const unknown = code => { if (!reasons.includes(code)) reasons.push(code) }
  const fail = (code, event) => { if (!violations.includes(code)) violations.push(code); if (event) refs.push({ thread: event.thread, call_id: event.call_id, timestamp: event.timestamp, order: event.order }) }
  const configured = config.evidenceVersion === EVIDENCE_VERSION && config.schedulingPolicy === 'required'
  const capacityVerified = contract?.status === 'PASS' && contract.cli === config.cli && contract.source === 'config/read' &&
    contract.workerCapacity === WORKER_CAPACITY && contract.primaryIncluded === false && contract.evidenceVersion === EVIDENCE_VERSION
  if (!configured) unknown('STRICT_POLICY_MISSING')
  if (!capacityVerified) unknown('CAPACITY_UNVERIFIED')
  const roots = events.filter(e => e.type === 'session_meta' && !e.parent)
  if (new Set(roots.map(e => e.thread)).size !== 1) unknown('ROOT_IDENTITY_UNVERIFIED')
  const parent = roots[0]?.thread
  const requests = events.filter(e => e.type === 'spawn_arguments' && e.thread === parent && rules.includes(e.task))
  const calls = new Set()
  const entries = []
  for (const rule of rules) {
    const matches = requests.filter(e => e.task === rule)
    if (matches.length > 1) fail('DUPLICATE_RULE_SUBMISSION', matches[1])
    if (matches.length !== 1) { unknown('RULE_REQUEST_MISSING'); continue }
    const request = matches[0]
    if (!request.call_id || calls.has(request.call_id)) unknown('CALL_ID_AMBIGUOUS')
    calls.add(request.call_id)
    if (request.overridesModel || request.overridesEffort || request.forkTurns !== 'none') fail('SPAWN_CONFIGURATION_VIOLATION', request)
    if (request.overridesModel !== false || request.overridesEffort !== false) unknown('SPAWN_CONFIGURATION_UNVERIFIED')
    const returns = events.filter(e => (e.type === 'tool_return' && e.tool === 'spawn_agent' || e.type === 'collab_agent_spawn_end' && e.returned === true) && e.thread === parent && e.call_id === request.call_id)
    if (returns.length !== 1) { unknown('SPAWN_RETURN_UNVERIFIED'); continue }
    const returned = returns[0]
    const identities = events.filter(e => e.type === 'session_meta' && e.parent === parent && e.path === `/root/${rule}`)
    const ids = [...new Set(identities.map(e => e.thread))]
    if (ids.length !== 1 || returned.path && returned.path !== `/root/${rule}` || (returned.id ?? returned.new_thread_id) && (returned.id ?? returned.new_thread_id) !== ids[0]) {
      unknown('WORKER_IDENTITY_UNVERIFIED'); continue
    }
    const id = ids[0]
    const contexts = events.filter(e => e.type === 'turn_context' && e.thread === id)
    if (!contexts.length || contexts.some(e => e.model !== config.model || e.effort !== config.effort)) unknown('ACTUAL_CONFIGURATION_UNVERIFIED')
    const starts = events.filter(e => e.type === 'worker_turn_started' && e.thread === id)
    const ends = events.filter(e => e.type === 'worker_turn_completed' && e.thread === id && e.valid === true)
    const stopped = events.some(e => e.type === 'host_status' && e.agents?.some(a => a.path === `/root/${rule}` && terminal.has(a.status)))
    if (starts.length !== 1 || ends.length !== 1 || !stopped && !ends.length) unknown('WORKER_INTERVAL_UNVERIFIED')
    const start = starts[0], end = ends[0]
    if (![request, returned, start, end].every(e => Number.isFinite(time(e))) || time(returned) < time(request) || time(end) < time(start) || time(start) < time(request)) unknown('EVENT_TIME_UNVERIFIED')
    if (!Number.isSafeInteger(request.order) || !Number.isSafeInteger(returned.order) || returned.order <= request.order) unknown('PARENT_ORDER_UNVERIFIED')
    entries.push({ rule, id, request, returned, start, end })
  }
  if (new Set(entries.map(e => e.id)).size !== rules.length) unknown('ROSTER_UNVERIFIED')
  const timeline = entries.flatMap(e => Number.isFinite(time(e.start)) && Number.isFinite(time(e.end)) && time(e.end) > time(e.start) ? [{ at: time(e.start), delta: 1 }, { at: time(e.end), delta: -1 }] : []).sort((a, b) => a.at - b.at || a.delta - b.delta)
  let active = 0, maximum = 0
  for (const event of timeline) { active += event.delta; maximum = Math.max(maximum, active) }
  if (capacityVerified && maximum > contract.workerCapacity) unknown('CAPACITY_SEMANTICS_CONFLICT')
  const firstRequestOrder = Math.min(...requests.map(e => e.order))
  const waits = events.filter(e => e.type === 'tool_request' && e.thread === parent && e.order >= firstRequestOrder && ['wait', 'wait_agent', 'list_agents'].includes(e.tool))
  const extraOpenAt = (child, at) => !events.some(e =>
    e.type === 'worker_turn_completed' && e.thread === child.thread && time(e) <= at ||
    e.type === 'host_status' && time(e) <= at && e.agents?.some(a => a.path === child.path && terminal.has(a.status)))
  for (const wait of waits) {
    if (!wait.call_id || !events.some(e => e.thread === parent && e.call_id === wait.call_id &&
      (e.type === 'tool_return' || e.type === 'host_status' || e.type === 'collab_waiting_end' && e.returned === true) && Number.isSafeInteger(e.order) && e.order > wait.order)) unknown('WAIT_RETURN_UNVERIFIED')
  }
  if (capacityVerified && entries.length === rules.length) {
    for (const wait of waits) {
      if (!Number.isSafeInteger(wait.order) || !Number.isFinite(time(wait))) { unknown('WAIT_ORDER_UNVERIFIED'); continue }
      const pending = entries.some(e => e.request.order > wait.order)
      if (!pending) continue
      const inflight = entries.some(e => e.request.order < wait.order && e.returned.order > wait.order)
      // A child ending is not proof the parent already received that fact.
      // The first status query after filling capacity is legitimate even for fast tasks.
      const knownStopped = entry => events.some(e => e.thread === parent && e.order < wait.order && (
        e.type === 'host_status' && e.agents?.some(a => a.path === `/root/${entry.rule}` && terminal.has(a.status)) ||
        e.type === 'collab_waiting_end' && terminal.has(e.statuses?.[entry.id]) ||
        e.type === 'agent_activity' && e.id === entry.id && ['completed', 'interrupted', 'errored', 'shutdown'].includes(e.kind)))
      const open = entries.filter(e => e.request.order < wait.order && !knownStopped(e)).length
      // Full capacity permits waiting; a finished fast task permits immediate replenishment.
      const extra = events.some(e => e.type === 'session_meta' && e.parent === parent && !entries.some(w => w.id === e.thread) &&
        (!Number.isFinite(time(e)) || time(e) <= time(wait) && extraOpenAt(e, time(wait))))
      if (extra) unknown('EXTRA_CHILD_CAPACITY_UNVERIFIED')
      else if (!inflight && open < contract.workerCapacity) fail('WAIT_WITH_AVAILABLE_CAPACITY', wait)
    }
    // Unknown extra children can consume capacity: do not attribute a scheduling violation.
    if (events.some(e => e.type === 'session_meta' && e.parent === parent && !entries.some(w => w.id === e.thread) &&
      (!Number.isFinite(time(e)) || entries.some(w => time(e) <= time(w.end) && extraOpenAt(e, time(w.request)))))) unknown('EXTRA_CHILD_CAPACITY_UNVERIFIED')
  }
  return { status: violations.length ? 'FAIL' : reasons.length ? 'UNVERIFIED' : 'PASS',
    reasons: [...violations, ...reasons], evidence: refs, capacity: capacityVerified ? { workers: contract.workerCapacity, primaryIncluded: false, source: 'config/read' } : null,
    maximumActualConcurrency: entries.length === rules.length && !reasons.includes('WORKER_INTERVAL_UNVERIFIED') && !reasons.includes('EVENT_TIME_UNVERIFIED') ? maximum : null,
    configuration: { policy: configured ? 'PASS' : 'UNVERIFIED', capacity: capacityVerified ? 'PASS' : 'UNVERIFIED' } }
}

export function assessControls(events, config, contract) {
  const fastRules = Array.from({ length: 6 }, (_, i) => `control_fast_${i}`)
  const holdRules = Array.from({ length: 6 }, (_, i) => `control_hold_${i}`)
  const fast = assessScheduling(events, config, contract, fastRules)
  const held = assessScheduling(events, config, contract, holdRules)
  const allRules = [...fastRules, ...holdRules]
  const identities = events.filter(e => e.type === 'session_meta' && allRules.some(rule => e.path === `/root/${rule}`))
  const starts = events.filter(e => e.type === 'worker_turn_started' && identities.some(id => id.thread === e.thread))
  const ends = events.filter(e => e.type === 'worker_turn_completed' && identities.some(id => id.thread === e.thread))
  const times = [...starts, ...ends].map(time)
  const bounded = starts.length === 12 && ends.length === 12 && times.every(Number.isFinite) && Math.max(...times) - Math.min(...times) <= 300000 &&
    identities.every(id => {
      const a = starts.find(e => e.thread === id.thread), b = ends.find(e => e.thread === id.thread)
      return a && b && time(b) >= time(a) && time(b) - time(a) <= 30000
    })
  const heldOperations = holdRules.every(rule => identities.some(id => id.path === `/root/${rule}` && events.some(e =>
    e.type === 'control_hold' && e.thread === id.thread && e.exitCode === 0)))
  const concurrency = held.maximumActualConcurrency >= 2 && heldOperations
  return { status: fast.status === 'FAIL' || held.status === 'FAIL' ? 'FAIL' :
    fast.status === 'PASS' && held.status === 'PASS' && bounded && concurrency ? 'PASS' : 'UNVERIFIED',
    fast, held, bounded, concurrency }
}
