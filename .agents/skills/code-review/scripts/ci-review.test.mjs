import { contract, strictFixture } from './ci-scheduling-fixture.test.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareReview, validateManifest, validateResult, assessReview, commentBody, newerComment, publish } from './ci-review.mjs'
import { CLI_VERSION, RULES, digest, save, canonical } from './ci-runtime.mjs'

function temp(t) {
  const root = mkdtempSync(join(tmpdir(), 'review-ci-test-'))
  t.after(() => { assert.ok(resolve(root).startsWith(resolve(tmpdir()))); rmSync(root, { recursive: true, force: true }) })
  return root
}
function git(repo, ...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
function fixture(t, docs = false) {
  const parent = temp(t), repo = join(parent, 'repo'), root = join(parent, 'run')
  mkdirSync(repo)
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'CI Test'); git(repo, 'config', 'user.email', 'ci@example.invalid')
  writeFileSync(join(repo, 'widget.ts'), 'export const value = 1\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, docs ? 'README.md' : 'widget.ts'), docs ? 'documentation\n' : 'export const value = 2\n')
  writeFileSync(join(repo, 'widget.test.mjs'), '// excluded\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'head')
  return { repo, root, base, head: git(repo, 'rev-parse', 'HEAD') }
}

test('CI preparation reuses original helper, locks head and creates read-only materials separate from scratch', t => {
  const f = fixture(t)
  const c = prepareReview(f.repo, f.root, f.base, f.head)
  assert.deepEqual(c.reviewFiles, ['widget.ts'])
  const m = JSON.parse(readFileSync(c.manifestPath))
  assert.equal(canonical(m.repositoryRoot), canonical(f.repo))
  assert.ok(m.layers.slice(1).every(l => l.paths.length === 0))
  assert.match(c.manifestPath, /materials/)
  const policy = readFileSync(join(f.root, 'codex-home/config.toml'), 'utf8')
  assert.match(policy, /runtime-tmp/)
  assert.doesNotMatch(policy, /materials.*write|repo.*write/)
  const direct = spawnSync(process.execPath, [join(f.root, 'skill/scripts/build-review-manifest.mjs'), '--base', f.base], {
    cwd: f.repo, encoding: 'utf8', env: { ...process.env, TMP: join(f.root, 'materials'), TEMP: join(f.root, 'materials'), TMPDIR: join(f.root, 'materials') },
  })
  assert.equal(direct.status, 0)
  const original = JSON.parse(readFileSync(direct.stdout.trim()))
  assert.deepEqual(original.textFiles, m.textFiles)
  assert.equal(original.sizeEligibleForLightReview, m.sizeEligibleForLightReview)
  assert.deepEqual(original.ruleCatalog, m.ruleCatalog)
  assert.deepEqual(original.layers.map(l => readFileSync(l.patchPath, 'utf8')), m.layers.map(l => readFileSync(l.patchPath, 'utf8')))
})

test('rename, deletion, binary and empty changes preserve original helper semantics', t => {
  const f = fixture(t)
  writeFileSync(join(f.repo, 'deleted.ts'), 'export const removed = true\n')
  writeFileSync(join(f.repo, 'renamed.ts'), 'export const renamed = true\n')
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'additional base')
  f.base = git(f.repo, 'rev-parse', 'HEAD')
  git(f.repo, 'mv', 'renamed.ts', 'renamed-next.ts')
  git(f.repo, 'rm', 'deleted.ts')
  writeFileSync(join(f.repo, 'binary.bin'), Buffer.from([0, 1, 255, 0]))
  writeFileSync(join(f.repo, 'empty.ts'), '')
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'edge cases')
  f.head = git(f.repo, 'rev-parse', 'HEAD')
  const c = prepareReview(f.repo, f.root, f.base, f.head)
  const direct = spawnSync(process.execPath, [join(f.root, 'skill/scripts/build-review-manifest.mjs'), '--base', f.base], {
    cwd: f.repo, encoding: 'utf8', env: { ...process.env, TMP: join(f.root, 'materials'), TEMP: join(f.root, 'materials'), TMPDIR: join(f.root, 'materials') },
  })
  assert.equal(direct.status, 0)
  const original = JSON.parse(readFileSync(direct.stdout.trim())), m = JSON.parse(readFileSync(c.manifestPath))
  assert.deepEqual(m.textFiles, original.textFiles)
  assert.deepEqual(m.layers.map(l => readFileSync(l.patchPath, 'utf8')), original.layers.map(l => readFileSync(l.patchPath, 'utf8')))
  assert.ok(!c.reviewFiles.includes('binary.bin'))
})

test('wrong head, dirty checkout and manifest escape fail without fallback', t => {
  const f = fixture(t)
  assert.throws(() => prepareReview(f.repo, f.root, f.base, f.base), /clean fixed head/)
  writeFileSync(join(f.repo, 'untracked.js'), 'x')
  assert.throws(() => prepareReview(f.repo, f.root, f.base, f.head), /clean fixed head/)
  rmSync(join(f.repo, 'untracked.js'))
  const c = prepareReview(f.repo, f.root, f.base, f.head)
  const m = JSON.parse(readFileSync(c.manifestPath))
  m.layers[0].patchPath = join(f.repo, 'widget.ts')
  save(c.manifestPath, m)
  assert.throws(() => validateManifest(f.root, f.repo, c.manifestPath, f.base), /outside/)
})

test('documentation and excluded test-only changes generate a completed zero-worker result', t => {
  const f = fixture(t, true)
  const c = prepareReview(f.repo, f.root, f.base, f.head)
  assert.equal(c.textFileCount, 0)
  const result = assessReview(join(f.root, 'public'), join(f.root, 'assessment'), { head: f.head })
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.workers, [])
  assert.ok(existsSync(join(f.root, 'public/observer-complete')))
})

test('trusted material operations verify context and reject changed patch without fallback', t => {
  const f = fixture(t)
  const c = prepareReview(f.repo, f.root, f.base, f.head)
  const operation = id => spawnSync(process.execPath, [join(f.root, 'skill/scripts/ci-review.mjs'), 'operation', f.root, id], { encoding: 'utf8' })
  assert.equal(operation('read-skill').status, 0)
  for (const rule of RULES) {
    const read = operation(`read-${rule}`)
    assert.equal(read.status, 0, read.stdout)
    assert.match(read.stdout, new RegExp(c.manifestHash))
    assert.match(read.stdout, /widget.ts/)
  }
  const m = JSON.parse(readFileSync(c.manifestPath))
  writeFileSync(m.layers[0].patchPath, 'tampered patch')
  const bad = operation('read-architect')
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /"status":"FAIL"/)
  assert.doesNotMatch(bad.stdout, /tampered patch/)
  const contextPath = join(f.root, 'private/context.json'), context = JSON.parse(readFileSync(contextPath))
  context.head = 'd'.repeat(40); save(contextPath, context)
  assert.equal(operation('read-skill').status, 1)
})

function runtimeEvidence(t) {
  const root = temp(t), output = join(root, 'assessment')
  const config = { base: 'a'.repeat(40), head: 'b'.repeat(40), run: '10', attempt: '1', model: 'gpt-6.1-sol', textFileCount: 1, reviewFiles: ['widget.ts'],
    manifestHash: digest('manifest'), patchHash: digest('patch'), skillHash: digest('skill'), ruleHashes: Object.fromEntries(RULES.map(r => [r, digest(r)])) }
  const final = { version: 2, statistics: { discarded: 0, merged: 0 }, status: 'complete', report: '## Standards\nNO_FINDINGS\n## AI Review Rules\nNO_FINDINGS\n## Summary\n完成。',
    tasks: RULES.map(rule => ({ rule, agent: `/root/${rule}`, status: 'completed' })), findings: [] }
  const time = n => `2026-11-11T01:00:${String(n).padStart(2, '0')}.000Z`
  const events = [
    { type: 'session_meta', thread: 'parent', cli: CLI_VERSION },
    { type: 'turn_context', thread: 'parent', model: config.model, sandbox: 'workspace-write' },
    { type: 'operation', thread: 'parent', operation: 'read-skill', status: 'PASS', exitCode: 0, hash: config.skillHash },
    ...RULES.flatMap((rule, i) => [
      { type: 'spawn_arguments', call_id: `spawn-${i}`, thread: 'parent', task: rule, overridesModel: false },
      { type: 'agent_activity', kind: 'started', id: `worker-${i}`, path: `/root/${rule}`, call_id: `spawn-${i}`, model: config.model, timestamp: time(i) },
      { type: 'session_meta', thread: `worker-${i}`, parent: 'parent', path: `/root/${rule}`, timestamp: time(i) },
      { type: 'turn_context', thread: `worker-${i}`, model: config.model },
      { type: 'worker_turn_started', thread: `worker-${i}`, timestamp: time(i) },
      { type: 'operation', thread: `worker-${i}`, operation: `read-${rule}`, status: 'PASS', exitCode: 0,
        manifestHash: config.manifestHash, patchHash: config.patchHash, ruleHash: config.ruleHashes[rule] },
      { type: 'worker_turn_completed', thread: `worker-${i}`, valid: true, timestamp: time(i + 15) },
    ]),
  ]
  strictFixture(config, events, RULES)
  save(join(root, 'runtime-contract.json'), contract)
  const persist = () => {
    save(join(root, 'config.json'), config); save(join(root, 'final.json'), final)
    save(join(root, 'events.json'), events); save(join(root, 'outcome.json'), { action: 'success' })
  }
  persist()
  return { root, output, config, final, events, persist }
}

test('real-file native evidence passes; valid findings do not block review', t => {
  const f = runtimeEvidence(t)
  f.final.findings.push({ sources: ['standards'], side: 'head', severity: 'Major', file: 'widget.ts', line: 1, title: 'Changed value', evidence: 'value = 2', trigger: 'Existing callers', impact: 'Wrong result' })
  f.final.report += '\nMajor widget.ts:1 Changed value\n'
  f.persist()
  const a = assessReview(f.root, f.output, { head: f.config.head, run: '10', attempt: '1' })
  assert.equal(a.status, 'complete')
  assert.equal(a.counts.Major, 1)
})

test('missing terminal, wrong material, model override, stale identity and failed calls never pass', t => {
  for (const scenario of ['terminal', 'material', 'model', 'head', 'failure', 'invalid-output']) {
    const f = runtimeEvidence(t)
    if (scenario === 'terminal') f.events.splice(f.events.findIndex(e => e.type === 'worker_turn_completed'), 1)
    if (scenario === 'material') f.events.find(e => e.operation === 'read-standards').manifestHash = digest('other')
    if (scenario === 'model') f.events.find(e => e.type === 'spawn_arguments').overridesModel = true
    if (scenario === 'invalid-output') f.events.find(e => e.type === 'worker_turn_completed').valid = false
    f.persist()
    if (scenario === 'failure') save(join(f.root, 'outcome.json'), { action: 'failure' })
    assert.equal(assessReview(f.root, f.output, { head: scenario === 'head' ? 'c'.repeat(40) : f.config.head }).status, 'incomplete', scenario)
  }
})

test('missing artifact and malformed findings retain explicit incomplete status', t => {
  const root = temp(t)
  assert.equal(assessReview(root, join(root, 'assessment')).status, 'incomplete')
  const f = runtimeEvidence(t)
  f.final.findings.push({ severity: 'Major', file: 'README.md', line: 1 })
  assert.throws(() => validateResult(f.final, f.config), /invalid finding/)
})

test('strict policy, capacity and spawn returns are required while valid findings survive failure', t => {
  for (const scenario of ['policy', 'capacity', 'return', 'effort']) {
    const f = runtimeEvidence(t)
    f.final.findings.push({ sources: ['standards'], side: 'head', severity: 'Minor', file: 'widget.ts', line: 1, title: 'Retained finding', evidence: 'value = 2', trigger: 'caller', impact: 'wrong value' })
    f.final.report += '\nMinor widget.ts:1 Retained finding\n'
    if (scenario === 'policy') delete f.config.schedulingPolicy
    if (scenario === 'capacity') rmSync(join(f.root, 'runtime-contract.json'))
    if (scenario === 'return') f.events.splice(f.events.findIndex(e => e.type === 'tool_return'), 1)
    if (scenario === 'effort') f.events.find(e => e.type === 'turn_context' && e.thread === 'worker-0').effort = 'high'
    f.persist()
    const result = assessReview(f.root, f.output)
    assert.equal(result.status, 'incomplete', scenario)
    assert.equal(result.counts.Minor, 1, scenario)
    assert.ok(result.reasons.length)
  }
})

test('publisher rechecks head after pagination and never overwrites a newer same-SHA attempt', async t => {
  const result = { version: 2, head: 'b'.repeat(40), run: '10', attempt: '1', status: 'complete', counts: { Critical: 0, Major: 0, Minor: 0 } }
  let writes = 0
  const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { number: 1 } }, serverUrl: 'https://github.com', runId: '10' }
  const github = { paginate: async () => [], rest: { issues: { listComments() {}, createComment: async () => { writes++ }, updateComment: async () => { writes++ } },
    pulls: { get: async () => ({ data: { state: 'open', draft: false, head: { sha: 'c'.repeat(40) } } }) } } }
  assert.equal(await publish(github, context, result, 'report'), 'stale')
  assert.equal(writes, 0)
  github.paginate = async () => [{ id: 1, user: { login: 'github-actions[bot]', type: 'Bot' }, body: `<!-- codex-pr-review -->\n<!-- codex-run ${result.head} 10 2 -->` }]
  assert.equal(await publish(github, context, result, 'report'), 'newer-result')
  assert.equal(writes, 0)
})
