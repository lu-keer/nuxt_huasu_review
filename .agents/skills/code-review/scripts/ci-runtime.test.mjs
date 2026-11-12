import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRecord, scanRollouts, save, assessWorkers, RULES, digest } from './ci-runtime.mjs'

function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'review-runtime-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('0.167.1 typed command and V2 status items retain evidence without arbitrary output', t => {
  const root = temporary(t)
  mkdirSync(join(root, 'public'))
  save(join(root, 'public/config.json'), { base: 'fixture', entrypoint: 'ci-review.mjs' })
  const command = `node ${join(root, 'skill/scripts/ci-review.mjs')} operation ${root} read-security`
  const projected = projectRecord({ type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'CommandExecution', command: ['bash', '-lc', command], exit_code: 1,
    aggregated_output: 'secret\nCAPABILITY_EVIDENCE {"operation":"read-security","status":"FAIL","failure":"permission_denied","diagnostic":"filesystem_permission_denied"}\n',
  } } }, 'parent', root)
  assert.equal(projected.status, 'FAIL')
  assert.equal(projected.diagnostic, 'filesystem_permission_denied')
  assert.doesNotMatch(JSON.stringify(projected), /secret/)
  const status = projectRecord({ type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'FunctionCallOutput', name: 'list_agents', id: 'status', output: JSON.stringify({ agents: [
      { agent_name: '/root/security', agent_status: 'interrupted' },
      { agent_name: '/root/standards', agent_status: { completed: 'NO_FINDINGS' } },
    ] }),
  } } }, 'parent', root)
  assert.deepEqual(status.agents.map(a => a.status), ['interrupted', 'completed'])
  assert.equal(status.agents[1].valid, true)
  assert.doesNotMatch(JSON.stringify(status), /NO_FINDINGS/)
})

test('typed exec output alone cannot authenticate a command', t => {
  const root = temporary(t)
  const record = { type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'FunctionCallOutput', name: 'exec_command', id: 'cmd',
    output: 'Process exited with code 0\nCAPABILITY_EVIDENCE {"operation":"read-skill","status":"PASS"}',
  } } }
  assert.equal(projectRecord(record, 'parent', root), null)
})

test('legacy fork history without a trustworthy boundary supplies no worker evidence', async t => {
  const root = temporary(t)
  mkdirSync(join(root, 'codex-home/sessions'), { recursive: true })
  const records = [
    { type: 'session_meta', payload: { id: 'child', parent_thread_id: 'parent', agent_path: '/root/standards' } },
    { type: 'session_meta', payload: { id: 'parent' } },
    { type: 'response_item', payload: { type: 'function_call', name: 'collaboration.list_agents', call_id: 'list', arguments: '{}' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'list', output: JSON.stringify({ agents: [{ agent_name: '/root/standards', agent_status: { completed: 'NO_FINDINGS' } }] }) } },
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ]
  writeFileSync(join(root, 'codex-home/sessions/child.jsonl'), records.map(r => JSON.stringify(r)).join('\n'))
  const { events } = scanRollouts(root)
  assert.ok(events.every(e => e.thread === 'child'))
  assert.deepEqual(events.map(e => e.type), ['session_meta'])
})

test('ordinal boundary excludes inherited activity and matched response outputs retain real status', async t => {
  const root = temporary(t)
  mkdirSync(join(root, 'codex-home/sessions'), { recursive: true })
  const records = [
    { type: 'session_meta', payload: { id: 'child', parent_thread_id: 'parent', subagent_history_start_ordinal: 10 } },
    { ordinal: 1, type: 'event_msg', payload: { type: 'task_started' } },
    { ordinal: 2, type: 'turn_context', payload: { model: 'parent-model' } },
    { ordinal: 10, type: 'event_msg', payload: { type: 'task_started' } },
    { ordinal: 11, type: 'turn_context', payload: { model: 'child-model' } },
    { ordinal: 12, type: 'response_item', payload: { type: 'function_call', name: 'collaboration.list_agents', call_id: 'list', arguments: '{}' } },
    { ordinal: 13, type: 'response_item', payload: { type: 'function_call_output', call_id: 'list', output: JSON.stringify({ agents: [{ agent_name: '/root/standards', agent_status: { completed: 'NO_FINDINGS' } }] }) } },
  ]
  writeFileSync(join(root, 'codex-home/sessions/child.jsonl'), records.map(r => JSON.stringify(r)).join('\n'))
  const { events } = scanRollouts(root)
  assert.equal(events.filter(e => e.type === 'worker_turn_started').length, 1)
  assert.deepEqual(events.filter(e => e.type === 'turn_context').map(e => e.model), ['child-model'])
  assert.equal(events.find(e => e.type === 'host_status').agents[0].valid, true)
})

function workerEvidence() {
  const config = { model: 'gpt-6.1-sol', patchHash: digest('patch'), ruleHashes: Object.fromEntries(RULES.map(rule => [rule, digest(rule)])) }
  const events = RULES.flatMap((rule, i) => [
    { type: 'spawn_arguments', thread: 'parent', task: rule, call_id: 'spawn-' + i, overridesModel: false },
    { type: 'session_meta', thread: 'worker-' + i, parent: 'parent', path: '/root/' + rule },
    { type: 'turn_context', thread: 'worker-' + i, model: config.model },
    { type: 'worker_turn_completed', thread: 'worker-' + i, valid: true, outputFormat: 'no_findings' },
    { type: 'operation', thread: 'worker-' + i, operation: 'read-' + rule, status: 'PASS', exitCode: 0,
      manifestHash: digest('manifest'), patchHash: config.patchHash, ruleHash: config.ruleHashes[rule] },
  ])
  return { config, events, evaluate: () => assessWorkers(events, config).workers }
}

test('runtime child metadata proves worker identities without legacy collab events', () => {
  const f = workerEvidence()
  assert.ok(f.evaluate().every(w => w.status === 'completed' && w.modelConfirmed))
  f.events.find(e => e.type === 'session_meta').parent = 'unrelated'
  assert.equal(f.evaluate()[0].status, 'unknown')
})

test('partial typed spawn and runtime metadata merge by identity', () => {
  const f = workerEvidence()
  f.events.unshift({ type: 'collab_agent_spawn_end', new_thread_id: 'worker-0' })
  assert.ok(f.evaluate().every(w => w.status === 'completed' && w.modelConfirmed))
})

test('durable completion remains valid after host status retires older entries', () => {
  const f = workerEvidence()
  assert.ok(f.evaluate().every(w => w.status === 'completed'))
  f.events.find(e => e.type === 'worker_turn_completed').valid = false
  assert.equal(f.evaluate()[0].status, 'completed / invalid_output')
})
