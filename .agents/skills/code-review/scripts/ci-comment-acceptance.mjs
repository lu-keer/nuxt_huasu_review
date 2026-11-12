// Controlled presentation fixtures only. Never represents model review evidence.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RULES } from './ci-runtime.mjs'
import { makeComment } from './ci-comment.mjs'
import { prepareDelivery } from './ci-review.mjs'
import { writeSummaryPart } from './ci-summary.mjs'

export async function runAcceptance(github, context, output, summaryTarget) {
  mkdirSync(output, { recursive: true })
  const pr = context.payload.pull_request
  if (pr.base.ref !== 'feat/ci-review-comment-template' || pr.head.ref !== 'feat/ci-comment-acceptance') throw new Error('acceptance PR identity mismatch')
  const repoUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}`
  const runUrl = `${repoUrl}/actions/runs/${context.runId}`
  const records = []
  for (const scenario of ['no-findings', 'findings', 'incomplete', 'no-text', 'long']) {
    const dir = join(output, scenario); mkdirSync(dir)
    const result = {
      version: 2, status: 'complete', base: pr.base.sha, head: pr.head.sha, run: String(context.runId), attempt: process.env.GITHUB_RUN_ATTEMPT,
      textFileCount: 1, manifestHash: 'controlled-presentation-fixture',
      counts: { Critical: 0, Major: 0, Minor: 0 }, statistics: { discarded: 0, merged: 0 }, findings: [], reasons: [],
      workers: RULES.map(rule => ({ rule, status: 'completed', reads: [{ status: 'PASS', manifestHash: 'controlled-presentation-fixture' }] })),
      locations: { 'app/components/AppDialog.vue': { head: 116, base: 116 } }, scheduling: { status: 'PASS' }, cli: 'controlled fixture', model: 'not called', effort: 'N/A',
    }
    if (['findings', 'incomplete', 'long'].includes(scenario)) {
      result.findings.push({ sources: ['standards', 'product_contract'], side: 'head', severity: 'Minor', file: 'app/components/AppDialog.vue', line: 43,
        title: '受控演示问题（不代表实际缺陷）', trigger: '仅用于模板验收', evidence: scenario === 'long' ? '受控代码证据；'.repeat(30000) : 'controlled fixture', impact: '验证展示与去重，不评价实际业务代码' })
      result.counts.Minor = 1; result.statistics.merged = 1
    }
    if (scenario === 'incomplete') { result.status = 'incomplete'; result.workers[5].status = 'timeout'; result.reasons = ['受控 security 超时（不是真实模型任务）'] }
    if (scenario === 'no-text') { result.textFileCount = 0; result.workers = []; result.scheduling.status = 'NOT_APPLICABLE' }
    const delivery = await prepareDelivery(github, context, result, dir)
    if (delivery.error) throw new Error(delivery.error)
    for (let part = 1; part <= delivery.parts; part++) writeSummaryPart(dir, part, summaryTarget)
    delivery.confirmed = true
    const rendered = makeComment(result, repoUrl, runUrl, delivery.url)
    const body = `**受控展示验收：${scenario}（非模型审查，状态与问题均为测试数据）**\n\n` + rendered.body
    const { data: comment } = await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body })
    writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 2))
    writeFileSync(join(dir, 'comment.md'), body)
    records.push({ scenario, url: comment.html_url, delivery, summaryBytes: delivery.parts ? readFileSync(join(dir, 'summary-1.md')).length : 0 })
  }
  writeFileSync(join(output, 'acceptance.json'), JSON.stringify(records, null, 2))
  return records
}
