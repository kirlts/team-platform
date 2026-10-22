// Stand-in for `compileOutputSchema(template)` of src/analyze/templates.js (A4, the output block a template declares).
// Until that exists in this branch the `execute` job loads this one: no declared output, so the job asks only for
// `summary`. The coordinator reconciles once A4 is merged.
export function compileOutputSchema () {
  return null
}
