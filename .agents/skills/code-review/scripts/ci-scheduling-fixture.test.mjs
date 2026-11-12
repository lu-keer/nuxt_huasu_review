// Shared synthetic evidence builder for integration tests; not a cloud attestation.
export const contract = { evidenceVersion: 2, cli: '0.167.1', source: 'config/read', status: 'PASS', workerCapacity: 2, primaryIncluded: false }
export function strictFixture(config, events, rules) {
  Object.assign(config, { evidenceVersion: 2, schedulingPolicy: 'required', workerCapacity: 2, cli: '0.167.1', effort: 'low' })
  const stamp = n => new Date(Date.UTC(2026, 10, 11, 1, 0, 0) + n * 1000).toISOString()
  for (const [i, rule] of rules.entries()) {
    const start = Math.floor(i / 2) * 20 + i % 2
    const request = events.find(e => e.type === 'spawn_arguments' && e.call_id?.endsWith(`-${i}`))
    Object.assign(request, { thread: 'parent', task: rule, forkTurns: 'none', overridesEffort: false, timestamp: stamp(start), order: (i * 2 + 1) * 10 })
    events.push({ type: 'tool_return', tool: 'spawn_agent', thread: 'parent', call_id: request.call_id, id: `worker-${i}`, timestamp: stamp(start + 0.1), order: (i * 2 + 2) * 10 })
    if (!events.some(e => e.type === 'session_meta' && e.thread === `worker-${i}`)) events.push({ type: 'session_meta', thread: `worker-${i}`, parent: 'parent', path: `/root/${rule}`, timestamp: stamp(start) })
    for (const e of events.filter(e => e.thread === `worker-${i}`)) {
      if (e.type === 'turn_context') e.effort = 'low'
      if (e.type === 'worker_turn_started') e.timestamp = stamp(start)
      if (e.type === 'worker_turn_completed') { e.timestamp = stamp(start + 10); if (e.valid === undefined) e.valid = true }
    }
  }
}

export function controlFixture(events, config) {
  for (const [groupIndex, kind] of ['fast', 'hold'].entries()) {
    const rules = Array.from({ length: 6 }, (_, i) => `control_${kind}_${i}`)
    const controls = rules.flatMap((rule, i) => [
      { type: 'spawn_arguments', call_id: `control-${kind}-${i}`, overridesModel: false },
      { type: 'turn_context', thread: `worker-${i}`, model: config.model },
      { type: 'worker_turn_started', thread: `worker-${i}` },
      { type: 'worker_turn_completed', thread: `worker-${i}`, valid: true },
    ])
    strictFixture(config, controls, rules)
    for (const e of controls) {
      if (e.thread?.startsWith('worker-')) e.thread = e.thread.replace('worker-', `control-${kind}-`)
      if (e.id?.startsWith('worker-')) e.id = e.id.replace('worker-', `control-${kind}-`)
      if (e.timestamp) e.timestamp = new Date(Date.parse(e.timestamp) + 120000 + groupIndex * 120000).toISOString()
      if (e.order) e.order += 1000 + groupIndex * 1000
    }
    events.push(...controls)
    if (kind === 'hold') events.push(...rules.map((_, i) => ({ type: 'control_hold', thread: `control-hold-${i}`, exitCode: 0 })))
  }
}
