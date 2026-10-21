# Prompts en dos idiomas, escritura sin marcas de IA, ventanas, asignación y áreas, 2026-10-21

Resultado: en el banco privado completo (39 casos, 3 repeticiones, 117 corridas) ninguna corrida terminó `invalid` y ningún mensaje quedó sin responsable. Antes, 6 a 9 de 39 casos terminaban `invalid` en cada corrida y la mitad de los mensajes no tenía responsable. La asignación exacta pasó de 26 % a 50,6 % con perfiles y proyecto. Las marcas de escritura de IA bajaron de unas 0,3 por mensaje a 0,02 (`es-419`) y 0,05 (`en`), pero no llegan a cero. Cuatro objetivos no se cumplen, con su causa: cero marcas, tiempo bajo 30 s en las transcripciones de más de 360 unidades (33 a 37 s en la mayor), cobertura de u13 (8 % contra 12 % antes) y exactitud de área (66 % contra 74 % con las descripciones cortas).

## Método

- Proveedor real, `claude-haiku-5-5`. Público: `node bench/run.mjs --repeat 5`, en `es-419` y en `en`. Privado: `node bench/run-private.mjs run --repeat 3 --team bench/private/team.json --project bench/private/project.md --variant rerun-h72`, equipo de cuatro miembros y descripción del proyecto de 200.937 caracteres.
- Antes: el código de `main` previo a esta rama (prompt en español, sin contrato de redacción), con el mismo `bench/`.
- Marcas de IA: `bench/ai-tells.js`, patrones en inglés y español con la sección de la guía «Signs of AI writing» que cada uno cita, más «el cuerpo repite el título» (UD-026). Un fragmento que el propio input contiene no cuenta. Medición del banco: nada en producción reescribe la prosa.
- Gasto del trabajo de prompts: unos 8,5 USD de análisis (iteraciones, variantes, repeticiones y el rerun) más pruebas con el proveedor real.

## Banco público (promedio de 5 repeticiones)

| Caso | Antes: cobertura / clasif. / tiempo | `es-419`: cobertura / clasif. / tiempo | `en`: cobertura / clasif. / tiempo |
|---|---|---|---|
| 01-chat-grupo | 89 % / 100 % / 5,4 s | 73 % / 97 % / 4,2 s | 100 % / 100 % / 4,8 s |
| 02-docx-40-puntos | 100 % / 94 % / 10,0 s | 100 % / 96 % / 15,5 s | 100 % / 96 % / 15,4 s |
| 03-monologo-prueba | 87 % / 89 % / 6,7 s | 84 % / 88 % / 7,8 s | 90 % / 86 % / 9,0 s |
| 04-reporte-de-error | 100 % / 100 % / 4,4 s | 100 % / 100 % / 4,9 s | 100 % / 100 % / 4,0 s |
| 05-idea-suelta | 100 % / 100 % / 3,6 s | 100 % / 100 % / 3,8 s | 100 % / 100 % / 3,1 s |
| 06-mensaje-mezclado | 100 % / 100 % / 3,7 s | 100 % / 100 % / 4,0 s | 100 % / 100 % / 4,1 s |
| 07-video-de-pantalla | 100 % / 100 % / 5,7 s | 100 % / 100 % / 4,3 s | 100 % / 100 % / 3,8 s |
| 08-reunion-10-minutos | 89 % / 96 % / 8,0 s | 100 % / 100 % / 6,7 s | 89 % / 100 % / 7,6 s |

- La cobertura del caso 03 es 84 % y 90 %, sobre el 80 % que se pedía; el 01 en español promedia 73 % porque una de las cinco corridas agrupó mal (mediana 100 %).
- El docx tarda 15 s contra 10 s antes. La causa es el semáforo de proveedores (7 peticiones simultáneas por proveedor, H-83): 41 llamadas en oleadas de 7. El pedido exceptuaba este caso del objetivo de 10 s.

## Marcas de IA por mensaje

| Caso | Antes | `es-419` | `en` |
|---|---|---|---|
| 02-docx-40-puntos | 0,48 | 0,01 | 0,06 |
| 03-monologo-prueba | 0,21 | 0,04 | 0,05 |
| 06-mensaje-mezclado | 0,56 | 0,00 | 0,00 |
| 07-video-de-pantalla | 0,17 | 0,05 | 0,00 |
| 08-reunion-10-minutos | 0,15 | 0,04 | 0,07 |
| Los otros tres casos | 0,00 | 0,00 | 0,00 |

Antes había 77 marcas en 3 repeticiones (unas 0,3 por mensaje), casi todas «no se indica…». Ahora quedan 8 (`es-419`, 0,02 por mensaje) y 20 (`en`, 0,05) en 5 repeticiones, y una tanda dirigida a los casos 02 y 08 tras los últimos ajustes dio 0,00 de mediana con 3 marcas sueltas entre 255 mensajes. Lo que bajó la cifra, por orden de efecto: el contrato de redacción, una línea en el cuerpo de las cinco plantillas («lo que el input no da no se menciona»), pedir cada parte del cuerpo solo si el input la da, un recordatorio al final del mensaje de usuario y la regla de que un campo sin dato lleva el valor vacío y no una frase. Quedan frases sueltas «no se indica» en pedidos de funcionalidad, una especulación y cuerpos que empiezan con el título. El detector no cuenta la especulación que la persona dijo y el modelo reporta.

## Banco privado completo (rerun-h72, 117 corridas)

| Medida | Antes (variante con proyecto, de `main`) | Después |
|---|---:|---:|
| Corridas `invalid` | 6 a 9 de 39 por corrida | 0 de 117 |
| Mensajes sin responsable | 20 % | 0 % |
| Asignación, conjunto exacto | 26,1 % | 50,6 % [44–57] |
| Asignación, precisión / recall | 50,2 % / 62,3 % | 72,7 % / 84,4 % |
| Cobertura de puntos | 63,3 % | 57,1 % [52–62] |
| Mensajes obtenidos / esperados | 705 / 752 | 1.456 / 1.128 (tres repeticiones) |
| Exactitud de área, unidades con mensaje, primer lector | n/a | 66,2 % |
| Exactitud de área, segundo lector | n/a | 65,3 % |
| Unión de las dos lecturas | n/a | 70,7 % |
| Cota superior imponible a ambos lectores | n/a | 99,9 % |

La cobertura y la cantidad de mensajes no son comparables con la columna «antes»: las referencias se corrigieron entre las dos mediciones.

### Reuniones largas (cobertura / tiempo, 3 repeticiones)

| Caso (unidades) | Antes (sin ventanas) | Después |
|---|---|---|
| r09 plan de acción (380) | 17 % / 64 s | 36 % / 9 a 16 s |
| r11 feedback (364) | 50 % / 160 s | 53 % / 23 a 37 s |
| u12 ficha parte 1 (1.042) | 19 % / 208 s | 20 % / 33 a 37 s |
| u13 ficha parte 2 (493) | 12 % / 87 s | 8 % / 18 a 23 s |

Qué cambió: la clasificación recorre ventanas contiguas de 100 unidades en paralelo (con una sola llamada el modelo agrupaba por tema todo lo del mismo área y salían 4 grupos para 400 unidades); lo que el modelo descarta entre la primera y la última unidad de un grupo vuelve al grupo; un grupo da un solo mensaje; solapes y huecos que sobreviven al único rescate se cierran por aritmética de conjuntos, y lo mismo el reparto de la clasificación. Ventanas de 200 daban 36 % de cobertura media en estos cuatro casos pero 35 a 38 s; de 150, 29 % y 21 s; de 100, 28 % y 20 s. Con 100 el tiempo cumple salvo en los dos casos mayores. La causa de lo que falta es el semáforo: u12 hace unas 47 llamadas y con 7 simultáneas son siete oleadas de 5 a 6 s. No se pudo bajar de 30 s sin subir el tope, que depende del límite de la cuenta.

## Invalid (H-84) y reparto (H-138)

- Las corridas `invalid` venían de solapes y huecos de unidades que el único rescate no cerraba y de clasificaciones con una unidad omitida. Hoy el sistema cierra ambos por aritmética de conjuntos y registra `repaired` y `classification_repaired` en las estadísticas.
- H-138, monólogo 03: antes 11 de 792 envíos (1,4 %) terminaban sin propuesta con «no logró repartir…». Después, 0 de 60 corridas con el proveedor real; 8 de las 60 habrían terminado así sin el cierre por aritmética. La prueba que lo reproduce está en `src/analyze/api.test.js` («if the rescue does not resolve the conflict, there is no second rescue: the rest is repaired by set arithmetic»).

## Asignación (H-85, H-86)

Sobre 12 casos, una corrida por variante:

| Variante | Exacto | Precisión | Recall | Sin responsable |
|---|---:|---:|---:|---:|
| A: reglas de asignación nuevas | 31,6 % | 87,2 % | 35,0 % | 51 % |
| B: A y miembros en el prompt de sistema tras el proyecto | 21,3 % | 85,7 % | 20,3 % | 62 % |
| C: A y al menos un responsable en la gramática | 55,6 % | 78,0 % | 71,5 % | 0 % |
| D: B y C | 56,3 % | 86,3 % | 67,4 % | 0 % |

Se adoptó C: la gramática del modelo exige al menos un id en `assignee_ids` cuando el equipo tiene miembros. Poner a los miembros tras el proyecto (B) no ayuda. La precisión de Alejandro pasó de 0 % a 43 %; la de Pablo es 4 % con 15 pares esperados.

## Áreas (H-91, UD-031)

Las definiciones de frontera salieron del prompt y viven en las descripciones de `templates/areas.json`: cuatro párrafos por área (qué es, casos típicos, casos borde con el desempate hacia las vecinas, qué no es), con las fronteras del segundo lector. Exactitud de área, unidades con mensaje, primer lector / segundo lector / unión:

| Descripciones | 39 casos | Cuatro reuniones largas |
|---|---|---|
| Cortas con un ejemplo y un casi igual (1 repetición) | 74,2 % / 75,5 % / 78,9 % | 69,8 % / 71,8 % / 73,4 % |
| Largas con las reglas del segundo lector (1 repetición) | n/a | 54,2 % / 51,4 % / 58,5 % |
| Largas con la regla de «debería» (1 repetición) | n/a | 62,6 % / 60,2 % / 67,5 % |
| Largas, rerun completo (3 repeticiones) | 66,2 % / 65,3 % / 70,7 % | n/a |

Las descripciones largas pedidas en UD-031 bajan la exactitud respecto de las cortas. La regla «mover, renombrar o reordenar es retroalimentación» hacía que el modelo clasificara como Retroalimentación o Pregunta lo que en las reuniones es una descripción de lo que el producto debe hacer. Con la regla de «debería» y la de que una sugerencia de arreglo es parte de la falla mejora, sin recuperar el nivel de las cortas. Es decisión del dueño mantener las largas; la medición queda como dato para ajustarlas desde el panel.

## Pendiente de la medición, con su causa

- Cero marcas por mensaje: quedan frases sueltas que ningún prompt elimina del todo sin reescribir la prosa, que está prohibido.
- Menos de 30 s en u12 y r11: lo fija el tope de 7 peticiones simultáneas por proveedor (`src/providers/limiter.js`).
- Comparación de Haiku con Sonnet y DeepSeek (H-80): no se corrió; costaría unos 3 USD solo con Sonnet.
