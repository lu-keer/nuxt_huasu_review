import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const workflow = readFileSync(new URL('../../../../.github/workflows/codex-review.yml', import.meta.url), 'utf8')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
function step(name) {
  const section = workflow.split(`- name: ${name}`)[1]
  assert.ok(section, name)
  const script = section.split('script: |')[1].split(/\r?\n(?=      -|  [a-z])/)[0]
    .split(/\r?\n/).filter(line => line.trim()).map(line => line.slice(12)).join('\n')
    .replace(/await import\(pathToFileURL\((?:tool|trusted)\)\.href\)/g, 'tools')
  return new AsyncFunction('require', 'process', 'github', 'context', 'core', 'tools', script)
}
function fixture(t, modern) {
  const root = mkdtempSync(join(tmpdir(), 'ci-workflow-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'review-report'); mkdirSync(dir)
  const result = { base: 'b', head: 'h', run: '123', attempt: '1', ...(modern ? { version: 2 } : {}) }
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result))
  writeFileSync(join(dir, 'report.md'), '## Standards\nLegacy verified report')
  const failures = [], calls = []
  const core = { info() {}, setOutput() {}, setFailed: x => failures.push(x) }
  const tools = { publish: async (...args) => { calls.push(args); return 'published' } }
  if (modern) tools.prepareDelivery = async () => {
    const delivery = { required: false, parts: 0, url: null, error: null }
    writeFileSync(join(dir, 'delivery.json'), JSON.stringify(delivery))
    return delivery
  }
  const context = { runId: 123, serverUrl: 'https://github.com', repo: { owner: 'o', repo: 'r' } }
  const process = { env: { RUNNER_TEMP: root, REVIEW_BASE_SHA: 'b', REVIEW_HEAD_SHA: 'h', GITHUB_RUN_ATTEMPT: '1' } }
  const run = name => step(name)(createRequire(import.meta.url), process, {}, context, core, tools)
  return { dir, tools, calls, failures, run }
}
for (const modern of [false, true]) {
  test(`workflow preserves trusted ${modern ? 'version 2' : 'legacy base'} delivery and publisher arguments`, async t => {
    const f = fixture(t, modern)
    await f.run('Prepare optional online summary')
    await f.run('Confirm online delivery')
    await f.run('Publish current head using trusted skill publisher')
    assert.deepEqual(f.failures, [])
    assert.equal(f.calls.length, 1)
    if (modern) assert.equal(f.calls[0][3].confirmed, true)
    else {
      assert.equal(typeof f.calls[0][3], 'string')
      assert.match(f.calls[0][3], /Legacy verified report/)
      assert.equal(f.calls[0][4], 'https://github.com/o/r/actions/runs/123')
    }
  })
}
test('workflow refuses missing legacy report instead of publishing an object', async t => {
  const f = fixture(t, false)
  await f.run('Prepare optional online summary'); await f.run('Confirm online delivery')
  rmSync(join(f.dir, 'report.md'))
  await f.run('Publish current head using trusted skill publisher')
  assert.equal(f.calls.length, 0); assert.match(f.failures[0], /Legacy report missing/)
})
test('workflow refuses a new result paired with legacy tools', async t => {
  const f = fixture(t, true); delete f.tools.prepareDelivery
  await f.run('Prepare optional online summary')
  assert.match(f.failures[0], /Unsupported trusted delivery contract/)
  assert.equal(f.calls.length, 0)
})
