export function isDocumentationPath(path) {
  const normalized = path.replaceAll('\\', '/').toLowerCase()
  return normalized.endsWith('.md') || ['docs', '.docs'].some(dir => normalized === dir || normalized.startsWith(`${dir}/`))
}

export function isTestPath(path) {
  return path.replaceAll('\\', '/').toLowerCase().endsWith('.test.mjs')
}

export function isReviewExcludedPath(path) {
  return isDocumentationPath(path) || isTestPath(path)
}
