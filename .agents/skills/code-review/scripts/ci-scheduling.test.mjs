import test from 'node:test'
import assert from 'node:assert/strict'
import { assessScheduling, RULE_IDS } from './ci-scheduling.mjs'
import { contract, strictFixture } from './ci-scheduling-fixture.test.mjs'

function fixture() {
  const config = { model: 'gpt-6.1-sol' }
  const events = [{ type: 'session_meta', thread: 'parent' }, ...RULE_IDS.flatMap((rule, i) => [
    { type: 'spawn_arguments', call_id: `spawn-${i}`, overridesModel: false },
    { type: 'turn_context', thread: `worker-${i}`, model: config.model },
    { type: 'worker_turn_started', thread: `worker-${i}` },
    { type: 'worker_turn_completed', thread: `worker-${i}`, valid: true },
  ])]
  strictFixture(config, events, RULE_IDS)
  return { events, config, evaluate: (proof = contract) => assessScheduling(events, config, proof) }
}

test('two slots permit grouped dispatch and waits only at capacity', () => {
  const f = fixture()
  f.events.push({ type: 'tool_request', thread: 'parent', tool: 'wait_agent', order: 45, call_id: 'wait', timestamp: '2026-11-11T01:00:02.000Z' })
  assert.equal(f.evaluate().status, 'UNVERIFIED') // no durable wait return
  f.events.push({ type: 'tool_return', thread: 'parent', tool: 'wait_agent', order: 46, call_id: 'wait', timestamp: '2026-11-11T01:00:11.000Z' })
  assert.equal(f.evaluate().status, 'PASS')
  assert.equal(f.evaluate().maximumActualConcurrency, 2)
})

test('milliseconds of overlap do not excuse waiting with a free slot', () => {
  const f = fixture()
  f.events.push({ type: 'tool_request', thread: 'parent', tool: 'list_agents', order: 25, call_id: 'early', timestamp: '2026-11-11T01:00:00.500Z' })
  assert.equal(f.evaluate().status, 'FAIL')
  assert.ok(f.evaluate().reasons.includes('WAIT_WITH_AVAILABLE_CAPACITY'))
})

test('fast completion and a blocking spawn return are not parent scheduling violations', () => {
  const fast = fixture()
  for (let i = 0; i < 6; i++) {
    const start = fast.events.find(e => e.type === 'worker_turn_started' && e.thread === `worker-${i}`)
    fast.events.find(e => e.type === 'worker_turn_completed' && e.thread === `worker-${i}`).timestamp = start.timestamp
  }
  assert.equal(fast.evaluate().status, 'PASS')
  const blocked = fixture()
  blocked.events.find(e => e.type === 'tool_return' && e.call_id === 'spawn-0').order = 35
  blocked.events.push({ type: 'tool_request', thread: 'parent', tool: 'wait_agent', order: 20, timestamp: '2026-11-11T01:00:00.050Z' })
  assert.notEqual(blocked.evaluate().status, 'FAIL')
})

test('first status query after fast tasks filled capacity is allowed; repeated waiting after known release fails', () => {
  const f = fixture()
  for (const e of f.events.filter(e => e.type === 'worker_turn_completed' && ['worker-0', 'worker-1'].includes(e.thread))) e.timestamp = '2026-11-11T01:00:01.500Z'
  f.events.push({ type: 'tool_request', thread: 'parent', tool: 'list_agents', order: 45, call_id: 'first', timestamp: '2026-11-11T01:00:02.000Z' },
    { type: 'host_status', thread: 'parent', order: 46, call_id: 'first', timestamp: '2026-11-11T01:00:02.100Z', agents: [
      { path: '/root/standards', status: 'completed' }, { path: '/root/architect', status: 'completed' },
    ] })
  assert.equal(f.evaluate().status, 'PASS')
  f.events.push({ type: 'tool_request', thread: 'parent', tool: 'wait_agent', order: 47, call_id: 'again', timestamp: '2026-11-11T01:00:03.000Z' })
  assert.equal(f.evaluate().status, 'FAIL')
})

test('native completion delivered to parent requires replenishing before another query', () => {
  const f = fixture()
  f.events.push({ type: 'agent_activity', thread: 'parent', order: 44, id: 'worker-0', kind: 'completed', timestamp: '2026-11-11T01:00:10.000Z' },
    { type: 'tool_request', thread: 'parent', tool: 'list_agents', order: 45, call_id: 'late', timestamp: '2026-11-11T01:00:10.100Z' })
  assert.equal(f.evaluate().status, 'FAIL')
  assert.ok(f.evaluate().reasons.includes('WAIT_WITH_AVAILABLE_CAPACITY'))
})

test('status queries before a control group starts are not that group scheduling evidence', () => {
  const f = fixture()
  f.events.push({ type: 'tool_request', thread: 'parent', tool: 'list_agents', order: 1, timestamp: '2026-11-11T00:59:00.000Z' })
  assert.equal(f.evaluate().status, 'PASS')
})

for (const [name, mutate, code] of [
  ['missing return', f => f.events.splice(f.events.findIndex(e => e.type === 'tool_return'), 1), 'SPAWN_RETURN_UNVERIFIED'],
  ['missing actual effort', f => delete f.events.find(e => e.type === 'turn_context').effort, 'ACTUAL_CONFIGURATION_UNVERIFIED'],
  ['wrong runtime identity', f => { f.events.find(e => e.type === 'tool_return').id = 'another-worker' }, 'WORKER_IDENTITY_UNVERIFIED'],
  ['missing terminal', f => f.events.splice(f.events.findIndex(e => e.type === 'worker_turn_completed'), 1), 'WORKER_INTERVAL_UNVERIFIED'],
  ['duplicate durable return', f => f.events.push({ ...f.events.find(e => e.type === 'tool_return') }), 'SPAWN_RETURN_UNVERIFIED'],
  ['missing order', f => delete f.events.find(e => e.type === 'spawn_arguments').order, 'PARENT_ORDER_UNVERIFIED'],
  ['policy downgrade', f => { f.config.schedulingPolicy = 'diagnose' }, 'STRICT_POLICY_MISSING'],
]) test(name + ' is unverified', () => {
  const f = fixture(); mutate(f)
  assert.equal(f.evaluate().status, 'UNVERIFIED')
  assert.ok(f.evaluate().reasons.includes(code))
})

for (const key of ['overridesModel', 'overridesEffort', 'forkTurns']) test(key + ' violation fails', () => {
  const f = fixture(); f.events.find(e => e.type === 'spawn_arguments')[key] = key === 'forkTurns' ? 'all' : true
  assert.equal(f.evaluate().status, 'FAIL')
})

test('unknown capacity and inherited parent requests never pass', () => {
  const f = fixture()
  assert.equal(f.evaluate(null).status, 'UNVERIFIED')
  f.events.find(e => e.type === 'spawn_arguments').thread = 'inherited-parent'
  assert.equal(f.evaluate().status, 'UNVERIFIED')
})

test('a repeated rule submission fails even when all worker intervals overlap', () => {
  const f = fixture(); f.events.push({ ...f.events.find(e => e.type === 'spawn_arguments'), call_id: 'duplicate' })
  assert.equal(f.evaluate().status, 'FAIL')
})
