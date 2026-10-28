#!/usr/bin/env node
// Captura cada boceto a 1440x900, claro y oscuro, sin ventana (headless).  node capturar.mjs
import * as playwright from '../../../../panel/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('.', import.meta.url))
const b = await playwright.chromium.launch()
for (const k of ['a-centralita', 'b-foro', 'c-aero']) for (const tema of ['light', 'dark']) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: tema })).newPage()
  await p.goto(`file://${dir}${k}.html?tema=${tema}`)
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)
  await p.screenshot({ path: `${dir}${k}-${tema}.png` })
  console.log(`${k}-${tema}.png`)
}
await b.close()
