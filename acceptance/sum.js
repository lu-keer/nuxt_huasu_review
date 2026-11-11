// Acceptance-only fixture: callers require sum([]) to return 0.
export function sum(values) {
  return values.reduce((total, value) => total + value)
}
