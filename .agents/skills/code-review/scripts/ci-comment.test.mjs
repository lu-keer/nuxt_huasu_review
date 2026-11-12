import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RULES } from './ci-runtime.mjs'
import { renderReview, makeComment, splitSummary, SUMMARY_BYTES } from './ci-comment.mjs'
import { prepareDelivery, validateResult, publish } from './ci-review.mjs'
import { writeSummaryPart } from './ci-summary.mjs'

const repo = 'https://github.com/owner/repo'
const run = repo + '/actions/runs/10'
function fixture() {
  return { version: 2, status: 'complete', head: 'b'.repeat(40), base: 'a'.repeat(40), run: '10', attempt: '1',
    counts: { Critical: 0, Major: 0, Minor: 0 }, statistics: { discarded: null, merged: null }, findings: [], reasons: [],
    textFileCount: 2, manifestHash: 'hash', locations: { '空 格/[x].vue': { head: 10, base: 20 } },
    workers: RULES.map(rule => ({ rule, status: 'completed', reads: [{ status: 'PASS', manifestHash: 'hash' }] })), scheduling: { status: 'PASS' } }
}
function finding(sources = ['standards']) {
  return { sources, side: 'head', severity: 'Major', file: '空 格/[x].vue', line: 5, title: 'title | <img> **fake**', evidence: 'if (x) return', trigger: 'request fails', impact: 'no feedback' }
}
test('normal comment starts at Standards and has five rows without redundant report or document', () => {
  const r = fixture(), c = makeComment(r, repo, run)
  assert.equal(c.summary, null)
  assert.match(c.body, /-->\n\n### Standards/)
  assert.equal((c.body.match(/references\/ai_review_rules\//g) ?? []).length, 5)
  assert.ok(c.body.indexOf('### Standards') < c.body.indexOf('### AI Review Rules'))
  assert.ok(c.body.indexOf('### AI Review Rules') < c.body.indexOf('### Summary'))
  assert.match(c.body, /剔除候选：未提供/)
  assert.doesNotMatch(c.body, /完整报告|artifact|查看详细审查文档|\/root\//)
})
test('findings render once, reference all sources, escape content, bind verified locations to side', () => {
  const r = fixture(); r.findings = [finding(['standards', 'product_contract'])]; r.counts.Major = 1
  const body = renderReview(r, repo)
  assert.equal((body.match(/触发条件：/g) ?? []).length, 1)
  assert.match(body, /product_contract.md` \| 已完成 \| F1/)
  assert.doesNotMatch(body, /<img>/)
  assert.ok(body.includes(`/blob/${r.head}/%E7%A9%BA%20%E6%A0%BC/%5Bx%5D.vue#L5`))
  r.findings[0].side = 'base'
  assert.ok(renderReview(r, repo).includes(`/blob/${r.base}/`))
  r.linkBase = 'c'.repeat(40)
  assert.ok(renderReview(r, repo).includes(`/blob/${r.linkBase}/`))
  r.findings[0].line = 99
  assert.match(renderReview(r, repo), /位置未验证/)
})
test('failure statuses and scheduling preserve findings and never claim whole review complete', () => {
  for (const status of ['errored', 'timeout', 'interrupted', 'unknown']) {
    const r = fixture(); r.status = 'incomplete'; r.workers[5].status = status; r.reasons = ['security failed']; r.findings = [finding()]; r.counts.Major = 1
    const body = renderReview(r, repo)
    assert.match(body, /审查未完成/); assert.match(body, /当前已核实 1 项问题/); assert.doesNotMatch(body, /六项必要审查全部完成/)
  }
  for (const status of ['FAIL', 'UNVERIFIED']) {
    const r = fixture(); r.status = 'incomplete'; r.scheduling.status = status; r.reasons = [`调度 ${status}`]
    assert.match(renderReview(r, repo).split('<details>')[0], new RegExp(`调度 ${status}`))
  }
})
test('no text means no workers or model and no claim six rules completed', () => {
  const r = fixture(); r.textFileCount = 0; r.workers = []; r.scheduling.status = 'NOT_APPLICABLE'
  const body = renderReview(r, repo)
  assert.equal((body.match(/\| 未运行 \|/g) ?? []).length, 5)
  assert.match(body, /未调用模型或启动 worker/)
  assert.doesNotMatch(body, /六项必要审查全部完成/)
})
test('long comments retain complete detail for online delivery and bounded index', () => {
  const r = fixture(); r.findings = Array.from({ length: 120 }, (_, i) => ({ ...finding(['security']), title: '问题' + i, evidence: '证据'.repeat(1000) })); r.counts.Major = 120
  const c = makeComment(r, repo, run, run + '/job/123')
  assert.ok(c.summary.length > 50000)
  assert.ok(Array.from(c.body).length <= 50000)
  assert.match(c.body, /查看详细审查文档/)
  assert.equal((c.summary.match(/触发条件：/g) ?? []).length, 120)
  const chunks = splitSummary(c.summary)
  assert.equal(chunks.join('\n\n'), c.summary)
  assert.ok(chunks.every(x => Buffer.byteLength(x) <= SUMMARY_BYTES))
  const multipart = Array(3).fill('段落'.repeat(100000)).join('\n\n')
  assert.equal(splitSummary(multipart).length, 3)
  assert.equal(splitSummary(multipart).join('\n\n'), multipart)
  assert.throws(() => splitSummary('a'.repeat(SUMMARY_BYTES + 1)), /paragraph/)
  assert.throws(() => splitSummary(Array(21).fill('a'.repeat(600000)).join('\n\n')), /20 step/)
})
test('old schema, invalid source and invalid statistics do not silently pass', () => {
  const value = { version: 2, statistics: { discarded: null, merged: 0 }, status: 'complete', report: 'Standards AI Review Rules Summary', tasks: [], findings: [finding()] }
  assert.equal(validateResult(value, { reviewFiles: [value.findings[0].file] }), value)
  value.version = 1; assert.throws(() => validateResult(value, {}), /version/)
  value.version = 2; value.statistics.merged = -1; assert.throws(() => validateResult(value, {}), /statistics/)
  value.statistics.merged = 0; value.findings[0].sources = ['invented']; assert.throws(() => validateResult(value, { reviewFiles: [value.findings[0].file] }), /finding/)
})
test('large finding index is reduced without dropping status or counts', () => {
  const r = fixture()
  r.findings = Array.from({ length: 500 }, (_, i) => ({ ...finding(['security']), title: '长标题'.repeat(30) + i }))
  r.counts.Major = 500
  const comment = makeComment(r, repo, run, run + '#summary-123')
  assert.ok(Array.from(comment.body).length <= 50000)
  assert.match(comment.body, /核实 500 项/)
  assert.match(comment.body, /未展示 [1-9]\d*/)
  assert.match(comment.body, /Major 500/)
  assert.equal((comment.summary.match(/触发条件：/g) ?? []).length, 500)
})
test('delivery uses API job URL and persists failure without fake document link', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'comment-delivery-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const r = fixture(), context = { repo: { owner: 'owner', repo: 'repo' }, serverUrl: 'https://github.com', runId: 10 }
  const api = { paginate: async () => [{ id: 123, name: 'review', run_id: 10, html_url: run + '/job/123' }], rest: { actions: { listJobsForWorkflowRunAttempt() {} } } }
  assert.equal((await prepareDelivery(api, context, r, dir)).required, false)
  r.findings = [{ ...finding(), evidence: 'large '.repeat(20000) }]; r.counts.Major = 1
  const ok = await prepareDelivery(api, context, r, dir)
  assert.equal(ok.url, run + '#summary-123'); assert.ok(readFileSync(join(dir, 'summary-1.md'), 'utf8').includes(r.head))
  writeSummaryPart(dir, 1, join(dir, 'step-summary'))
  assert.equal(readFileSync(join(dir, 'summary-1.ok'), 'utf8'), 'written')
  assert.throws(() => writeSummaryPart(dir, 1, null), /unavailable/)
  assert.throws(() => writeSummaryPart(dir, 1, join(dir, 'step-summary'), () => { throw new Error('disk failure') }), /disk failure/)
  assert.equal(readFileSync(join(dir, 'summary-error'), 'utf8'), 'Job Summary write failed')
  api.paginate = async () => []
  const fail = await prepareDelivery(api, context, r, dir)
  assert.match(fail.error, /URL unavailable/); assert.equal(fail.url, null)
  let body
  api.paginate = async () => []
  api.rest.issues = { listComments() {}, createComment: async x => { body = x.body } }
  api.rest.pulls = { get: async () => ({ data: { state: 'open', draft: false, head: { sha: r.head } } }) }
  context.payload = { pull_request: { number: 1 } }
  await publish(api, context, r, { ...ok, confirmed: false, error: 'write failed' })
  assert.match(body, /交付失败/); assert.doesNotMatch(body, /\[查看详细审查文档\]/)
})
