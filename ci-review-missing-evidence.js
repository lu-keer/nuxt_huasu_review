// Deliberate fixture defect: sum([]) should be 0, but reduce throws.
// Temporary acceptance branch only; must not be merged.
export function sum(values) {
  return values.reduce((total, value) => total + value)
}
