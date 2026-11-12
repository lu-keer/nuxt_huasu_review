import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { queryRuntimeContract } from './ci-runtime-contract.mjs'
import { projectRecord } from './ci-runtime.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'runtime-contract-'))
  for (const dir of ['public', 'controller', 'codex-home']) mkdirSync(join(root, dir))
  writeFileSync(join(root, 'codex-home/config.toml'), '[agents]\nmax_concurrent_threads_per_session = 6\n')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

for (const [capacity, status] of [[6, 'PASS'], [3, 'UNVERIFIED'], [null, 'UNVERIFIED']]) test(`effective capacity ${capacity} yields ${status}`, async t => {
  const root = fixture(t)
  const result = await queryRuntimeContract(root, (binary, args, options) => {
    assert.equal(binary, 'npx')
    assert.ok(args.includes('@openai/codex@0.167.1'))
    assert.ok(args.includes('default_permissions=":read-only"'))
    assert.equal(options.env.OPENAI_API_KEY, undefined)
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => {}
    child.stdin = new Writable({ write(chunk, encoding, next) {
      const request = JSON.parse(chunk)
      const result = request.id === 1 ? { userAgent: 'codex_cli_rs/0.167.1' } : { config: { agents: { max_concurrent_threads_per_session: capacity } } }
      if (request.id) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: request.id, result }) + '\n'))
      next()
    } })
    return child
  })
  assert.equal(result.status, status)
  assert.equal(JSON.parse(readFileSync(join(root, 'public/runtime-contract.json'))).status, status)
  assert.ok(!JSON.stringify(result).includes('userAgent'))
})

test('durable requests and returns retain identity and policy but never prompt/output text', t => {
  const root = fixture(t), calls = new Map()
  const record = (type, payload, ordinal) => ({ type, payload, ordinal, timestamp: '2026-11-11T00:00:00.000Z' })
  const request = projectRecord(record('response_item', { type: 'function_call', name: 'collaboration.spawn_agent', call_id: 'spawn',
    arguments: JSON.stringify({ task_name: 'architect', fork_turns: 'none', message: 'PRIVATE_PROMPT', reasoning_effort: 'low' }) }, 1), 'parent', root, calls)
  assert.equal(request.overridesEffort, true)
  assert.equal(request.forkTurns, 'none')
  const returned = projectRecord(record('response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ task_name: '/root/architect', private: 'PRIVATE_OUTPUT' }) }, 2), 'parent', root, calls)
  assert.equal(returned.type, 'tool_return')
  assert.equal(returned.path, '/root/architect')
  assert.equal(returned.order, 2)
  assert.doesNotMatch(JSON.stringify([request, returned]), /PRIVATE_/)
  const wait = projectRecord(record('response_item', { type: 'function_call', name: 'collaboration.wait_agent', call_id: 'wait', arguments: '{}' }, 3), 'parent', root, calls)
  assert.equal(wait.type, 'tool_request')
})
