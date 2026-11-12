import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUMMARY_BYTES, SUMMARY_PARTS } from './ci-comment.mjs'

export function writeSummaryPart(directory, part, target, append = appendFileSync) {
  if (!Number.isInteger(part) || part < 1 || part > SUMMARY_PARTS) throw new Error('invalid summary part')
  try {
    if (!target) throw new Error('GITHUB_STEP_SUMMARY unavailable')
    const content = readFileSync(join(directory, `summary-${part}.md`))
    if (content.length > SUMMARY_BYTES) throw new Error('summary step budget exceeded')
    append(target, content)
    writeFileSync(join(directory, `summary-${part}.ok`), 'written')
  } catch (error) {
    writeFileSync(join(directory, 'summary-error'), 'Job Summary write failed')
    throw error
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeSummaryPart(resolve(process.argv[2]), Number(process.argv[3]), process.env.GITHUB_STEP_SUMMARY)
}
