// One verb per kind of deletion (2026-10-26): what comes back from «Borradas» (areas, templates, sends, messages, replies) is
// «Borrar»/«borrado»; what does not come back (a member, a provider, the own account) is «Eliminar». Templates said «Eliminar»
// beside areas that said «Borrar», for the same reversible act.
import { describe, expect, it } from 'vitest'
import { es419 as es } from './i18n/es-419'

const PERMANENT = /^(team\.|providers\.|error\.(cannot_delete_self|member_retired)|audit\.a\.(member|settings\.connection)\.delete)/

describe('the verb of a deletion', () => {
  it('«eliminar» is only for what does not come back', () => {
    const wrong = Object.entries(es as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && /elimin/i.test(v))
      .map(([k]) => k)
      .filter((k) => !PERMANENT.test(k))
    expect(wrong).toEqual([])
  })
})
