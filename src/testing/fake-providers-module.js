// Providers module for tests that run the whole application (PROVIDERS_MODULE=./testing/fake-providers-module.js):
// the real analyzer and the real extractors talk to scripted fake providers, so a complete flow needs no network and
// no keys. `fakeState` carries what only the test knows (the area and template the classification must choose).
// Test support: nothing here is imported from production code.

import { createFakeProviders } from '../providers/fake.js'

export const fakeState = { areaId: null, templateId: null, calls: [] }

/** The unit numbers `[uN]` of the last user message of a request. */
function unitIdsIn (request) {
  const last = request.messages.at(-1)
  const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content)
  return [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]))
}

function textScript (request) {
  fakeState.calls.push('text')
  const units = unitIdsIn(request)
  if (request.schema.properties.groups) {
    return { json: { groups: [{ unit_ids: units, area_id: fakeState.areaId, template_id: fakeState.templateId }], discarded: [] } }
  }
  const fields = Object.keys(request.schema.properties.messages.items.properties.fields.properties ?? {})
  return {
    json: {
      messages: [{
        unit_ids: units,
        title: 'Test message',
        fields: Object.fromEntries(fields.map((name) => [name, 'datum'])),
        body: 'Body of the test message.',
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
    vision: (request) => {
      fakeState.calls.push('vision')
      if (request.schema?.properties?.frames) {
        return { json: { frames: request.images.map((_, i) => ({ index: i + 1, description: `screen ${i + 1}` })) } }
      }
      return { json: { description: 'A described image.' } }
    },
    speech: () => {
      fakeState.calls.push('speech')
      return { text: 'spoken words', segments: [{ start: 0, end: 1, text: 'spoken words' }] }
    }
  })
  return { ...providers, textFallback: null, describe: () => [] }
}
