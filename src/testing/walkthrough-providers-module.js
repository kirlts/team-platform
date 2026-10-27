// Providers module for the walkthrough on the Docker image (PROVIDERS_MODULE=./testing/walkthrough-providers-module.js):
// the real analyzer and the real extractors talk to scripted fake providers, so a whole flow runs with no network
// and no keys. Unlike fake-providers-module.js it needs no help from the test process (the test runs outside the
// container): the template comes from the first value of the classification schema, with the area that the catalog of the prompt says it belongs to.
// Test support: nothing here is imported from production code.

import { createFakeProviders } from '../providers/fake.js'

// The units are numbered in the first message that carries them; the retry after an invalid answer appends a message of feedback that does not.
const unitIdsIn = (request) => {
  for (const message of request.messages.filter((m) => m.role === 'user')) {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    const ids = [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]))
    if (ids.length > 0) return [...new Set(ids)]
  }
  return []
}

// The area of a template, from the catalog the prompt carries («Área 2: …», then «Plantilla 1: …» under it). The enums of the schema list the ids of areas and
// templates in an order of their own, so the first of each is not a pair that belongs together.
function areaOfTemplate (request, templateId) {
  const system = [].concat(request.system ?? []).map((b) => (typeof b === 'string' ? b : b.text ?? '')).join('\n')
  let area = null
  for (const line of system.split('\n')) {
    const a = /^(?:Área|Area) (\d+):/.exec(line)
    if (a) area = Number(a[1])
    const t = /^\s*(?:Plantilla|Template) (\d+):/.exec(line)
    if (t && Number(t[1]) === templateId) return area
  }
  return null
}

function textScript (request) {
  const units = unitIdsIn(request)
  // Cut pass (UD-293): nothing to cut.
  if (request.schema.properties.cuts) return { json: { cuts: [] } }
  const groups = request.schema.properties.groups
  if (groups) {
    const item = groups.items.properties
    const templateId = item.template_id.enum[0]
    return { json: { groups: [{ unit_ids: units, area_id: areaOfTemplate(request, templateId) ?? item.area_id.enum[0], template_id: templateId }], discarded: [] } }
  }
  // Split check of one written group: one request, so nothing is split.
  if (request.schema.properties.requests) return { json: { requests: [{ unit_ids: units, request: 'request' }] } }
  const fields = Object.keys(request.schema.properties.messages.items.properties.fields.properties ?? {})
  return {
    json: {
      messages: [{
        unit_ids: units,
        title: 'Walkthrough message',
        fields: Object.fromEntries(fields.map((name) => [name, 'datum'])),
        body: 'Body of the walkthrough message.',
        assignee_ids: [],
        attachment_ids: []
      }]
    }
  }
}

export function createProviders () {
  const providers = createFakeProviders({
    name: 'fake',
    model: 'fake-model',
    text: textScript,
    vision: (request) => (request.schema?.properties?.frames
      ? { json: { frames: request.images.map((_, i) => ({ index: i + 1, description: `screen ${i + 1}` })) } }
      : { json: { description: 'A described image.' } }),
    speech: () => ({ text: 'spoken words', segments: [{ start: 0, end: 1, text: 'spoken words' }] })
  })
  return { ...providers, textFallback: null, describe: () => [] }
}
