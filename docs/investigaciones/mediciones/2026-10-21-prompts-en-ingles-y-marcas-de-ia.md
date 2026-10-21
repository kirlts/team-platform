# Prompts en dos idiomas y marcas de escritura de IA, 2026-10-21

Resultado: el juego `es-419` tiene la misma cobertura que el prompt anterior en los ocho casos y baja las marcas de IA de 77 a 34 (la frase «no se indica» de 74 a 32; en el docx, de 0,48 a 0,19 por mensaje). El juego en inglés baja a 30 marcas, pero pierde cobertura en el caso 01 (100 % a 67 %) y en el 03 (90 % a 80 %). Ningún caso llegó a cero marcas. Las filas que faltan están en `docs/HALLAZGOS.md` (H-80 a H-84).

## Método

- Proveedor real: Anthropic `claude-haiku-5-5`, llave de `~/.config/team-platform/env`. Tres repeticiones por caso, `node bench/run.mjs --repeat 3`.
- Antes: el código de `main` anterior a la pasada de inglés (prompt en español, sin contrato de redacción), con el mismo `bench/` y las mismas funciones de medición.
- Después: la rama `wt-ingles`, una corrida con `--language es-419` y otra con `--language en`. Los casos están en español; en la corrida en inglés se mide que la salida sea inglesa (columna `lang`: 100 % en todos los casos).
- Marcas: `bench/ai-tells.js`, 38 patrones en inglés y español, cada uno con la sección de la guía «Signs of AI writing» que lo origina. Un fragmento que el propio input contiene no cuenta. Es una medición del banco: nada en producción reescribe ni filtra la prosa.
- Caso nuevo, `08-reunion-10-minutos`: reunión sintética de 45 líneas (10 minutos) con nueve puntos, de los cuales tres son de proceso (flujo de ramas, contrato con un cliente, incorporación de otro cliente), un tema que vuelve minutos después, y charla y elogios que se descartan.
- La corrida final cambió el contrato dos veces (tres iteraciones en total) y agregó el recordatorio al final del mensaje de usuario. Las filas de abajo son de la última.

## Cobertura y tiempo por caso (mediana de tres corridas)

| Caso | Antes: cobertura / tiempo | `es-419`: cobertura / tiempo | `en`: cobertura / tiempo |
|---|---|---|---|
| 01-chat-grupo | 100 % / 5,4 s | 100 % / 4,9 s | 67 % / 4,4 s |
| 02-docx-40-puntos | 100 % / 10,0 s | 100 % / 9,9 s | 100 % / 9,4 s |
| 03-monologo-prueba | 90 % / 6,7 s | 90 % / 6,5 s | 80 % / 6,5 s |
| 04-reporte-de-error | 100 % / 4,4 s | 100 % / 4,0 s | 100 % / 4,0 s |
| 05-idea-suelta | 100 % / 3,6 s | 100 % / 3,1 s | 100 % / 3,3 s |
| 06-mensaje-mezclado | 100 % / 3,7 s | 100 % / 4,1 s | 100 % / 3,4 s |
| 07-video-de-pantalla | 100 % / 5,7 s | 100 % / 4,2 s | 100 % / 4,3 s |
| 08-reunion-10-minutos | 89 % / 8,0 s | 89 % / 6,3 s | 89 % / 5,2 s |

La referencia de `docs/investigaciones/mediciones/2026-10-20-primera-corrida-real.md` daba 80 % en el caso 03. Hoy el prompt anterior da 90 % en la misma máquina, así que la comparación es contra 90 %. La mediana de tiempo no sube en ningún caso.

## Marcas de IA por mensaje

| Caso | Antes | `es-419` | `en` |
|---|---|---|---|
| 01-chat-grupo | 0,00 | 0,00 | 0,00 |
| 02-docx-40-puntos | 0,48 | 0,19 | 0,19 |
| 03-monologo-prueba | 0,21 | 0,10 | 0,06 |
| 04-reporte-de-error | 0,00 | 0,00 | 0,00 |
| 05-idea-suelta | 0,00 | 0,00 | 0,00 |
| 06-mensaje-mezclado | 0,56 | 0,22 | 0,00 |
| 07-video-de-pantalla | 0,17 | 0,27 | 0,08 |
| 08-reunion-10-minutos | 0,15 | 0,09 | 0,13 |
| Total de marcas | 77 | 34 | 30 |

Por patrón, antes: 74 frases «no se indica…» y 3 especulaciones. Después en `es-419`: 32 y 2. En `en`: 24 «not specified», 2 «not available», 1 «note that» y 3 «it is not urgent, but». Estas tres últimas son la traducción fiel de «no es urgente, pero…» que dijo la persona: un falso positivo del patrón, porque la exclusión solo cubre texto idéntico al input.

Causa de las que quedan: las plantillas sembradas piden en el cuerpo partes como «cómo se llega a la falla», «quién lo necesita» o «los criterios de listo», y el modelo escribe «no se indican los pasos» cuando el input no las da. La regla del contrato («omite el detalle del cuerpo, aunque la plantilla lo mencione») la redujo a la mitad, no a cero. Falta probar el ajuste de las plantillas (H-81).

## Tokens de salida y velocidad (H-12)

| Caso | Antes | `es-419` | `en` |
|---|---|---|---|
| 02-docx-40-puntos | 11.687 | 10.651 | 9.037 |
| 03-monologo-prueba | 4.308 | 3.700 | 3.388 |
| 08-reunion-10-minutos | 4.328 | 3.734 | 3.043 |

La salida baja entre 9 % y 30 %. Los cuerpos repiten los campos de la plantilla palabra por palabra y el contrato lo prohíbe; el resto del ahorro viene de las frases «no se indica».

Entrada larga sintética: la reunión del caso 08 repetida 16 veces con la hora corrida (64 KB, 720 unidades). Antes: 28,4 s, 14 llamadas, 13.460 tokens de salida, 27 mensajes. Después, con `es-419`: 16,9 s, 11 llamadas, 7.818 tokens de salida, 9 mensajes. El texto repetido hace que el modelo agrupe más de lo que haría con una reunión real, así que esta cifra no reproduce el caso de 57 KB con 208 s y 72.000 tokens de salida del banco privado. Ese caso se mide con `node bench/run-private.mjs run` desde `main`.

En la corrida en inglés de la misma entrada larga, la clasificación dejó 15 unidades repetidas sin ubicar y devolvió `invalid` (una vez). Las unidades eran idénticas entre sí por construcción del texto.

## Cambios que entran a `main` con esta medición

- Contrato de redacción de unos 380 tokens en la descomposición de los dos juegos, con la lista de vocabulario en inglés y en español.
- Regla de idioma repetida después del input y un recordatorio final de lo que las plantillas tienden a pasar por encima.
- Reglas del clasificador: un punto es lo que la persona pidió, decidió o informó, sea o no del producto; las unidades seguidas van juntas; se descartan elogios y muletillas.
- Prueba con el proveedor real de que un input en inglés con `language: 'es-419'` sale en español y al revés (`src/analyze/regressions.live.test.js`): pasó en las dos direcciones en la última corrida. En una corrida previa la salida en inglés para un input en español salió en español hasta que la regla de idioma se repitió después del input.
