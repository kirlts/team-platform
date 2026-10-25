// Providers module for the walkthrough on the Docker image (PROVIDERS_MODULE=./testing/walkthrough-providers-module.js):
// the real analyzer and the real extractors talk to scripted fake providers, so a whole flow runs with no network
// and no keys. Unlike fake-providers-module.js it needs no help from the test process (the test runs outside the
// container): the area and the template come from the first values of the classification schema.
// Test support: nothing here is imported from production code.

import { createFakeProviders } from '../providers/fake.js'

const unitIdsIn = (request) => {
  const last = request.messages.at(-1)
  const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
  return [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]))
}

function textScript (request) {
  const units = unitIdsIn(request)
  // Cut pass (UD-292): nothing to cut.
  if (request.schema.properties.cuts) return { json: { cuts: [] } }
  const groups = request.schema.properties.groups
  if (groups) {
    const item = groups.items.properties
    return { json: { groups: [{ unit_ids: units, area_id: item.area_id.enum[0], template_id: item.template_id.enum[0] }], discarded: [] } }
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
