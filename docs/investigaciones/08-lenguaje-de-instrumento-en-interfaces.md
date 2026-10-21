# Lenguaje de instrumento en interfaces generadas con modelos, octubre de 2026

Consultado el 2026-10-21. Alimenta UD-050: el texto visible del panel se escribe como el de un programa de gestión estándar, no como una conversación. «Sin verificar» marca lo que sólo se vio en el resumen de un buscador. El buscador sólo devuelve resultados de Estados Unidos. No se pudieron leer Material Design, Apple HIG, GOV.UK, Atlassian, Polaris, IBM Design Language ni la guía de copy de Primer (páginas vacías, 403 o 404). Ninguna se cita.

## 1. Resumen

La evidencia de 2025 y 2026 sostiene la parte práctica de la regla y sólo una parte de su forma. Lo que sostiene: el relleno conversacional no agrega información (NN/g, 2026-01-09). La microcopia cumple primero claridad, luego concisión, y deja el carácter en tercer lugar (NN/g, 2026-03-20). Un tono juguetón en un error duplicó las consultas a soporte de un equipo (Parallel, 2026-05-15). Las guías leídas piden rótulos cortos, un término por acción, errores con causa y salida, y ni exclamaciones ni «por favor» ni humor.

Lo que no sostiene: «sin segunda persona». Adobe Spectrum, Grafana y Microsoft recomiendan hablarle a la persona de «tú» o «you». La prohibición es una decisión de estilo del dueño con respaldo parcial. Un programa de gestión logra su registro sin hablarle a nadie. Las guías que lo permiten lo limitan a oraciones completas, nunca a rótulos. La investigación no encontró ningún estudio que mida la reacción de una persona al copy conversacional de una interfaz hecha por IA. Lo que existe son listas de verificación de profesionales y artículos de opinión.

## 2. Qué se dice del vicio

### 2.1 Origen en el modelo

Un modelo conversacional escribe el texto de una pantalla como una respuesta de chat: segunda persona, saludo, explicación de lo que la pantalla ya muestra. Los trabajos sobre el estilo de texto de modelos coinciden en que el ajuste con retroalimentación humana premia la longitud, la calidez y la adulación. Las citas son de Shaib y otros (arXiv 2509.19163, 2025), Reinhart y otros (PNAS, 2025) y Sharma y otros (ICLR 2024); no se reverificaron hoy. NN/g agrega que las interfaces con modelos amplifican el efecto con primera persona, lenguaje emocional y cortesías. Son decisiones de diseño, no un destino [1].

### 2.2 Qué dicen las fuentes

| Fuente | Fecha | Qué dice | Uso en la regla |
|---|---|---|---|
| [1] NN/g, Caleb Sponheim, «Humanizing AI Is a Trap» | 2026-01-09 | Las frases de apertura como «Love this brief» no agregan información. Cita un estudio de 2025 donde los modelos más cálidos tuvieron entre 10 % y 30 % más de errores. Recomienda herramientas centradas en la función, salvo producto explícitamente relacional | R2, R9 |
| [2] NN/g, Taylor Dykes, «The 3 C's of Informational Microcopy» | 2026-03-20 | Orden de prioridad: claridad, concisión, carácter. «Every word must serve a purpose». El carácter «should not get in the way of concision and clarity» | R1, R10 |
| [3] NN/g, Neusesser y Sunwall, «Error-Message Guidelines» | 2023-05-14 | Tono positivo y sin humor; no culpar con «invalid» o «illegal»; describir el problema exacto y ofrecer remedio; ocultar códigos oscuros salvo diagnóstico | R6 |
| [4] Parallel, Robin Dhanwani, «10 UX Writing Principles: 2026 Guide» | 2026-05-15 | Un término por acción; botón con verbo y objeto; presente y voz activa; un equipo duplicó las consultas a soporte tras un error con «Oopsie!»; decidir una vez el tratamiento (primera o segunda persona) y aplicarlo siempre | R4, R5, R8 |
| [5] Grafana Writers' Toolkit, UX writing | consultada 2026-10-21, sin fecha | Botones con verbo, de una a dos palabras, cuatro como máximo; sin punto en elementos de una oración; sin «por favor»; no usar «invalid» en errores; ayuda mínima; confirmaciones sólo cuando interrumpir vale la pena. Pide hablar de «you» | R3, R6, R7, R11 |
| [6] Adobe Spectrum, Grammar and mechanics | consultada 2026-10-21, sin fecha | Sin signos de exclamación («difíciles de localizar y fáciles de abusar»); sin punto en botones; fragmentos breves sin punto, oraciones completas con punto. Pide «you»/«your» la mayoría de las veces | R7, R8 |
| [7] Microsoft Writing Style Guide, «Brand voice: simple and human» | publicada 2018-01-19, actualizada 2026-10-15 | «Warm and relaxed», «talk like a person», contracciones. Es la postura opuesta: voz conversacional con la persona | contraejemplo, sección 5 |
| [8] IBM Carbon, Content | actualizada 2026-09-30 | Capitalización de oración en títulos, rótulos y avisos; copy claro, conciso y accionable; términos estandarizados. No fija reglas de segunda persona ni de ayuda | R1, R8 |
| [9] GitHub Primer, Empty states | sin fecha | Un título que explica el propósito, un texto secundario breve y no redundante, una sola acción primaria. Para errores: sin lenguaje técnico oscuro, específico, sin tono juguetón. Admite un tono «welcoming and human» para el primer uso | R6, R12 |
| Búsqueda de UI microcopy en directorios de skills (resultado de buscador, sin verificar) | 2026 | Lista de verificación de práctica: verbo más objeto en botones, errores con qué pasó, por qué y cómo salir, estado vacío con la única acción disponible, sin vocabulario de IA, sin saludos vacíos, sin «Please» | R3, R4, R12 |
| Wikipedia «Signs of AI writing», tropes.md (2026-03) | no reverificadas hoy | Catálogo de marcas: trascendencia inflada, «not X but Y», anuncio antes de la respuesta, cierre que resume | R9 |

### 2.3 Lo que no se encontró

Ninguna fuente mide cuánto confunde o fatiga el copy conversacional en una interfaz de gestión. El material de 2026 sobre «AI slop» trata sobre todo el aspecto visual (paletas, radios, centrado). Del texto sólo menciona los saludos vacíos, el vocabulario de IA y el relleno. Los artículos de junio y mayo de 2026 sobre diseño genérico (noqta.tn, ecosistemastartup.com) se vieron sólo en el resumen del buscador. La regla de este repositorio queda como decisión de estilo con las razones de la sección 1, no como hallazgo empírico.

## 3. Reglas

Cada regla dice si la guardia (`panel/src/ui-voice.test.ts`) la comprueba sola o si exige revisión humana. «M» es mecánica sobre los catálogos y sobre las frases de progreso que el servidor entrega; «H» es de revisión.

| # | Regla | Fuente | Tipo |
|---|---|---|---|
| R1 | Un rótulo es un sustantivo o grupo nominal corto. Tope por texto: 10 palabras por variante, 14 en un error | [2], [5], [8]; medido en el catálogo (sección 6) | M |
| R2 | Sin saludos, cortesías, exclamaciones ni apertura que no sea dato («Hola», «Bienvenido», «Gracias», «Oops», «Parece que», «Aquí», «Ya», «Todavía», «Aún») | [1], [3], [6] | M |
| R3 | Sin segunda persona: sin tú, usted, vos, tu, te, ti, ni formas verbales dirigidas («puedes», «tienes», «enviaste»), ni «you», «your», «we», «please», «let's» | decisión del dueño, [5] sobre «please» | M |
| R4 | Un botón o acción es un verbo en infinitivo (español) o imperativo estándar (inglés) más su objeto. Sin imperativos coloquiales de segunda persona («escribe», «elige») | [4], [5] | M |
| R5 | Una acción, un término, en todo el producto | [4] | H |
| R6 | Un error dice causa y, si hay una salida, la salida. Sin culpar («inválido» sobre lo escrito por la persona), sin humor, sin código a la vista salvo diagnóstico | [3], [5], [9] | H |
| R7 | Sin signos de interrogación en la interfaz; sin exclamaciones; sin punto final en un texto de una oración y sin dos oraciones en un mismo texto | [5], [6], decisión del dueño | M |
| R8 | Estado como etiqueta de una o dos palabras («Analizando», «Para revisar»); un gerundio al inicio sólo en un estado de una o dos palabras. Una frase de progreso no empieza con gerundio | [4] | M |
| R9 | Sin adjetivos vacíos, sin trascendencia inflada, sin «simplemente», «fácilmente», «robusto», «integral» y las demás palabras de la lista de la guardia | [1] | M (lista corta) y H (revisión de cada texto nuevo) |
| R10 | Un texto de ayuda no existe por omisión. Sólo con él la persona evita un error o una pérdida, y entonces es una oración impersonal con el dato | [2], [5] | H |
| R11 | Una confirmación sólo precede una acción que no se deshace, y dice la consecuencia. Un aviso destructivo puede ser una oración corta e impersonal | [5] | H |
| R12 | Un estado vacío es un rótulo («Sin áreas») y, si la hay, la acción. No explica la función | [9] | M en el largo (R1), H en el sentido |
| R13 | El texto de un marcador de posición no repite el rótulo ni da órdenes; muestra la forma del dato | [5] | H |
| R14 | Los dos idiomas llevan el mismo registro y las mismas claves; la guardia aplica las reglas por separado a cada catálogo | UD-018 | M |

## 4. Contraejemplos y corrección

Las filas 2 a 5 son del producto en `main` al 2026-10-21 y se corrigen en la purga base (H-1500). La primera es el ejemplo del dueño y las demás ilustran cada regla.

| Texto | Regla | Corrección en español | Corrección en inglés |
|---|---|---|---|
| «Nota de voz con su transcripción» | R1 | «Nota de voz» | «Voice note» |
| «Lo enviaste tú» / «You sent it» | R3 | «Enviado por mí» | «Sent by me» |
| «Escribe o adjunta» / «Write or attach» (marcador de posición) | R3, R4, R13 | «Texto o adjuntos» | «Text or attachments» |
| «Ya existe un envío tuyo con ese contenido» / «You already sent this same content» | R2, R3 | «Envío duplicado» | «Duplicate send» |
| «Ya existe un miembro con ese correo» | R2 | «Correo en uso» | «Email in use» |
| «Aquí puedes ver tus mensajes» | R2, R3 | «Mensajes» | «Messages» |
| «¡Todo listo! Tu propuesta está lista para revisar» | R2, R3, R7, R9 | «Propuesta lista» | «Proposal ready» |
| «Todavía no hay nada por aquí» | R2, R12 | «Sin mensajes» | «No messages» |
| «¿Qué quieres hacer con este envío?» | R3, R7 | «Envío» como título y los botones «Descartar» y «Revisar» | «Send», «Discard», «Review» |
| «Analizando tu envío, un momento...» | R3, R8 | «Analizando» | «Analyzing» |
| «Oops, algo salió mal» | R2, R6 | «No se pudo guardar: sin conexión con el servidor» | «Could not save: no connection to the server» |
| «Por favor, ingresa un correo válido» | R3, R4, R6 | «Correo inválido» (campo) o «Falta el correo» | «Invalid email», «Email missing» |
| «Se descarta esta propuesta con sus cambios y el envío se analiza de nuevo.» (aviso de una acción que no se deshace) | R11 | Se conserva: una oración impersonal con la consecuencia, sin punto final | se conserva |

## 5. Qué se conserva y por qué

- Una oración impersonal y precisa en un aviso destructivo (R11): sin ella la persona pierde trabajo.
- Lo que el dueño pidió textual: rótulos cortos (UD-013), edición en el lugar sin botones «Editar» ni «Guardar» (UD-017) y las palabras «Por atender», «Pendiente» y «Novedad» de cada prioridad (UD-029). Ninguno es conversacional y no se tocan.
- Las descripciones de área y las plantillas iniciales de `templates/`: son instrucciones largas escritas para el modelo y las edita el Editor (UD-031). No son texto de la interfaz en el sentido de la regla, aunque el panel las muestre en el editor.
- El texto que escribe una persona (mensajes, respuestas, perfil, descripción del proyecto) y lo que genera el modelo (UD-019). La guardia sólo mira texto del producto.

Microsoft [7] y Adobe [6] recomiendan la voz conversacional. Acá no se siguen. Un panel de gestión de uso diario gana más con rótulos estables que con calidez, y NN/g [1] cita un costo en la calidez de un modelo. Si el producto cambia de público, UD-050 se revisa.

## 6. Medición del catálogo

Se contó sobre `panel/src/i18n/es-419.ts` y `en.ts` en `main` el 2026-10-21, con 487 claves cada uno (76 de `error.`, 48 de `analysis.error.` y 363 de otro tipo). Las variables y las citas entre comillas cuentan como una palabra. Antes de la purga, el error más largo medía 14 palabras (`error.units_uncovered`). Fuera de los errores, el texto más largo medía 10 palabras por variante, salvo `analysis.againWarning` con 14, el aviso de una acción que no se deshace. De ahí los topes de R1: 14 en un error y 10 en el resto, con esa única excepción declarada en la guardia. La purga cambió 18 claves en español, 21 en inglés y 37 frases de progreso del servidor (H-1500).

## Fuentes

1. Sponheim, C. «Humanizing AI Is a Trap». Nielsen Norman Group, 2026-01-09. https://www.nngroup.com/articles/humanizing-ai/
2. Dykes, T. «The 3 C's of Informational Microcopy». Nielsen Norman Group, 2026-03-20. https://www.nngroup.com/articles/3-cs-microcopy/
3. Neusesser, T. y Sunwall, E. «Error-Message Guidelines». Nielsen Norman Group, 2023-05-14. https://www.nngroup.com/articles/error-message-guidelines/
4. Dhanwani, R. «10 UX Writing Principles: 2026 Guide to Microcopy & UX». Parallel, 2026-05-15. https://www.parallelhq.com/blog/ux-writing-best-practices
5. Grafana Labs. «UX writing», Writers' Toolkit. Consultada 2026-10-21. https://grafana.com/docs/writers-toolkit/write/style-guide/ux-writing/
6. Adobe. «Grammar and mechanics», Spectrum. Consultada 2026-10-21. https://spectrum.adobe.com/page/grammar-and-mechanics
7. Microsoft. «Microsoft's brand voice: above all, simple and human». Publicada 2018-01-19, actualizada 2026-10-15. https://learn.microsoft.com/en-us/style-guide/brand-voice-above-all-simple-human
8. IBM. «Content», Carbon Design System. Actualizada 2026-09-30. https://carbondesignsystem.com/guidelines/content/overview/
9. GitHub. «Empty states», Primer. Consultada 2026-10-21. https://primer.style/product/ui-patterns/empty-states/
10. Wikipedia. «Signs of AI writing». https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (no reverificada hoy)
