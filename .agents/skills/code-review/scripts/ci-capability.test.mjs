import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { assess, CLI_VERSION, observe, prepare, projectRecord, RULES, summarize } from './ci-capability.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const save = (path, value) => writeFileSync(path, JSON.stringify(value))
function temporary(t) {
  const root = mkdtempSync(join(tmpdir(), 'capability-test-'))
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')))
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function evidence(t, mode = 'probe') {
  const dir = temporary(t)
  const payload = 'long-delivery-fixture\n'.repeat(900)
  const config = { mode, model: 'gpt-6.1-sol', skillHash: hash('skill'), patchHash: hash('patch'),
    ruleHashes: Object.fromEntries(RULES.map(id => [id, hash(id)])), deliveryHash: hash(payload), deliveryLength: payload.length }
  save(join(dir, 'config.json'), config)
  save(join(dir, 'outcome.json'), { action: 'success' })
  save(join(dir, 'final.json'), { report: 'Standards\nAI Review Rules\nSummary\n', delivery_payload: payload })
  const timestamp = n => `2026-11-11T00:00:${String(n).padStart(2, '0')}.000Z`
  const events = [
    { type: 'session_meta', thread: 'parent', cli: CLI_VERSION },
    { type: 'turn_context', thread: 'parent', model: config.model, sandbox: 'read-only' },
    ...['read-skill', 'build-snapshot', 'write-source', 'write-temp', 'read-instructions'].map(operation =>
      ({ type: 'operation', operation, thread: 'parent', status: 'PASS', exitCode: 0, hash: config.skillHash })),
    ...RULES.flatMap((rule, i) => [
      { type: 'spawn_arguments', call_id: `call-${i}`, overridesModel: false },
      { type: 'collab_agent_spawn_end', call_id: `call-${i}`, new_thread_id: `worker-${i}`, timestamp: timestamp(i), model: config.model },
      { type: 'turn_context', thread: `worker-${i}`, model: config.model },
      { type: 'worker_turn_started', thread: `worker-${i}`, timestamp: timestamp(i) },
      { type: 'worker_turn_completed', thread: `worker-${i}`, timestamp: timestamp(15 + i) },
      { type: 'operation', thread: `worker-${i}`, operation: `read-${rule}`, status: 'PASS', exitCode: 0,
        manifestHash: hash('manifest'), patchHash: config.patchHash, ruleHash: config.ruleHashes[rule] },
      { type: 'collab_waiting_end', statuses: { [`worker-${i}`]: 'completed' }, valid_outputs: { [`worker-${i}`]: true }, timestamp: timestamp(20 + i) },
    ]),
    { type: 'collab_agent_spawn_end', new_thread_id: 'control', control: true, status: 'running' },
    { type: 'collab_close_end', receiver_thread_id: 'control', status: 'shutdown' },
  ]
  save(join(dir, 'events.json'), events)
  return { dir, events, config }
}

test('six distinct native workers, overlapping intervals, inherited model and confirmed cancellation unlock rehearsal', t => {
  const { dir } = evidence(t)
  const report = assess(dir)
  assert.equal(report.nativeReady, true)
  assert.equal(report.checks.cancellation, 'PASS')
  assert.equal(report.checks.delivery, 'PASS')
  assert.equal(report.checks.rehearsal, 'UNVERIFIED')
})

test('model self-report and matching model without spawn arguments cannot prove inheritance', t => {
  const { dir, events } = evidence(t)
  save(join(dir, 'events.json'), events.filter(e => e.type !== 'spawn_arguments'))
  assert.equal(assess(dir).nativeReady, false)
  assert.equal(assess(dir).checks.concurrency_model, 'UNVERIFIED')
})

test('cancel request without host terminal does not unlock rehearsal', t => {
  const { dir, events } = evidence(t)
  save(join(dir, 'events.json'), events.filter(e => e.type !== 'collab_close_end'))
  assert.equal(assess(dir).checks.cancellation, 'UNVERIFIED')
  assert.equal(assess(dir).nativeReady, false)
})

test('late wait observations do not turn sequential worker execution into concurrency', t => {
  const { dir, events } = evidence(t)
  save(join(dir, 'events.json'), events.filter(e => !e.type.startsWith('worker_turn_')))
  assert.equal(assess(dir).checks.concurrency_model, 'UNVERIFIED')
})

test('duplicate workers and missing material hashes are not six-rule coverage', t => {
  const { dir, events } = evidence(t)
  for (const event of events) if (event.type === 'operation') delete event.manifestHash
  save(join(dir, 'events.json'), events)
  assert.equal(assess(dir).checks.delegation, 'UNVERIFIED')
})

test('missing credentials, failed calls and invalid output never produce a passing environment', t => {
  const { dir } = evidence(t)
  for (const action of ['skipped', 'failure', 'cancelled']) {
    save(join(dir, 'outcome.json'), { action })
    assert.notEqual(assess(dir).checks.environment, 'PASS')
    assert.equal(assess(dir).nativeReady, false)
  }
  rmSync(join(dir, 'final.json'))
  assert.equal(assess(dir).checks.delivery, 'UNVERIFIED')
})

test('truncated delivery payload is rejected without truncating the stored message', t => {
  const { dir } = evidence(t)
  save(join(dir, 'final.json'), { report: 'Summary', delivery_payload: 'short' })
  assert.equal(assess(dir).checks.delivery, 'UNVERIFIED')
})

test('temporary writes blocked select prepared mode; source writes allowed block the native gate', t => {
  const { dir, events } = evidence(t)
  for (const e of events) if (['build-snapshot', 'write-temp'].includes(e.operation)) { e.status = 'FAIL'; e.exitCode = 1 }
  save(join(dir, 'events.json'), events)
  assert.equal(assess(dir).nativeReady, true)
  assert.equal(assess(dir).rehearsalMode, 'prepared')
  events.find(e => e.operation === 'write-source').status = 'FAIL'
  save(join(dir, 'events.json'), events)
  assert.equal(assess(dir).nativeReady, false)
})

test('projections discard arbitrary output, prompts, credential-shaped fields and non-canonical commands', t => {
  const root = temporary(t)
  mkdirSync(join(root, 'public'))
  save(join(root, 'public/config.json'), { base: 'base' })
  const record = { type: 'event_msg', payload: { type: 'collab_agent_spawn_end', new_thread_id: 'id', model: 'gpt-6.1-sol',
    prompt: 'secret', status: { completed: 'sk-secret' }, token: 'secret' } }
  const safe = projectRecord(record, 'parent', root)
  assert.equal(safe.status, 'completed')
  assert.doesNotMatch(JSON.stringify(safe), /secret|prompt|token/)
  const command = `node ${join(root, 'skill/scripts/ci-capability.mjs')} operation ${root} read-skill`
  const exec = { type: 'event_msg', payload: { type: 'exec_command_end', command: ['bash', '-lc', command], exit_code: 0,
    aggregated_output: 'sk-secret\nCAPABILITY_EVIDENCE {"operation":"read-skill","status":"PASS","token":"secret"}\n' } }
  assert.doesNotMatch(JSON.stringify(projectRecord(exec, 'parent', root)), /secret|token/)
  exec.payload.command[2] = command + '; echo spoof'
  assert.equal(projectRecord(exec, 'parent', root), null)
})

test('observer publishes only allowlisted evidence, exact long payload, and no raw rollout/auth files', async t => {
  const root = temporary(t)
  for (const dir of ['public', 'private', 'codex-home/sessions']) mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'codex-home/auth.json'), 'private credential')
  writeFileSync(join(root, 'delivery-input.txt'), 'delivery')
  writeFileSync(join(root, 'codex-home/sessions/test.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'id', cli_version: CLI_VERSION, base_instructions: 'private credential' } }) + '\n')
  save(join(root, 'private/final.json'), { report: 'Bearer SECRET and sk-secret', delivery_payload: 'delivery' })
  save(join(root, 'private/outcome.json'), { action: 'success', token: 'private credential' })
  await observe(root)
  assert.ok(existsSync(join(root, 'public/observer-complete')))
  assert.doesNotMatch(readFileSync(join(root, 'public/events.json'), 'utf8'), /private credential/)
  assert.doesNotMatch(readFileSync(join(root, 'public/final.json'), 'utf8'), /SECRET|sk-secret/)
  assert.equal(existsSync(join(root, 'public/auth.json')), false)
})

test('real fixture uses unchanged manifest helper and excludes ignored, documentation and test files', t => {
  const parent = temporary(t)
  const root = join(parent, 'isolated')
  const result = prepare(root, 'probe')
  const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8'))
  assert.deepEqual(manifest.textFiles, ['sample.js'])
  assert.ok(manifest.layers.filter(layer => layer.kind !== 'committed').every(layer => layer.paths.length === 0))
  assert.equal(existsSync(join(root, 'public/prompt.md')), false)
  assert.throws(() => prepare(root, 'probe'), /must not exist/)
})

test('summary distinguishes native and adapted rehearsal; absent artifacts remain incomplete', t => {
  const input = temporary(t)
  const output = join(temporary(t), 'report')
  assert.equal(summarize(input, output).conclusion, '原生方案暂不可接入')
  const probe = evidence(t)
  const rehearsal = evidence(t, 'prepared')
  // Copy public fixture artifacts into the same layout as download-artifact.
  cpSync(probe.dir, join(input, 'capability-probe'), { recursive: true })
  cpSync(rehearsal.dir, join(input, 'capability-rehearsal'), { recursive: true })
  assert.equal(summarize(input, output).conclusion, '需最小适配后接入')
})

