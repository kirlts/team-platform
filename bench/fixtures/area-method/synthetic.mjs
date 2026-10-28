// Invented corpora with a known amount of signal, for the tests of the criteria of the method. Nothing here is real data.
//   sizes   rows per area, e.g. { big: 140, small: 12 }
//   noise   share of the words of a summary that come from a vocabulary common to every area (0: every word says the area, 1: none does)
//   perUnit rows per unit; the rows of one unit repeat the same summary, as several requests from one message tend to do
//   leak    the module says the area even when the summary does not
//   unitWords every unit adds three words that only it uses, as a message that mentions its own names does
import { seededRandom } from '../../../scripts/area-method.mjs'

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const SHARED = 'cambiar revisar cliente sistema pagina correo lista datos nuevo viejo'.split(' ')

export function syntheticCorpus ({ sizes, noise = 0.5, seed = 1, perUnit = 1, leak = false, unitWords = false, confidential = false }) {
  const rand = seededRandom(seed)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const rows = []
  let count = 0
  let current = null
  Object.entries(sizes).forEach(([area, n], ai) => {
    const vocabulary = Array.from({ length: 8 }, (_, i) => `zz${LETTERS[ai]}${LETTERS[i]}qa`) // letters only: the tokenizer drops words with digits
    for (let i = 0; i < n; i++) {
      if (count % perUnit === 0) {
        const own = unitWords ? Array.from({ length: 3 }, () => `qq${Array.from({ length: 6 }, () => LETTERS[Math.floor(rand() * 26)]).join('')}`) : []
        current = { unit: `s${count / perUnit}`, summary: [...Array.from({ length: 6 }, () => (rand() < noise ? pick(SHARED) : pick(vocabulary))), ...own].join(' ') }
      }
      count++
      rows.push({
        unit: current.unit, date: `2026-03-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`, who: pick(['Ana', 'Beto', 'Carla']), to: 'Asistente', summary: current.summary,
        intent: pick(['falla', 'ajuste', 'pregunta']), object: area, module: leak ? `m${ai}${Math.floor(rand() * 6)}` : `m${Math.floor(rand() * 6)}`,
        understand_vs_create: +rand().toFixed(2), severity: +rand().toFixed(2), irreversibility: +rand().toFixed(2), missing_value: +rand().toFixed(2),
        value_holder: pick(['model', 'Ana', 'nobody']), limits: rand() < 0.3 ? ['money'] : [], maximize: `cualidad ${area}`, sacrifice: `resto ${area}`, urgency: +rand().toFixed(2), correction: false, source: 'chat', confidential
      })
    }
  })
  return rows
}
