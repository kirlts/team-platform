# Estrategia de pruebas

> Contrato de pruebas del proyecto. Doctrina: pirámide invertida (contratos y prohibiciones primero, dobles al final) heredada de dos proyectos anteriores del autor; cada comprobación es una prohibición que cita la restricción o la fila de la especificación que protege.
> Fecha: 2026-10-20

## La regla que ordena todo

**Cada comprobación es una prohibición.** Una prueba que afirma «el sistema puede hacer X» se aprueba escribiendo más código; una que afirma «el sistema no puede hacer Y» no. Por eso la batería intenta hacer lo que el sistema debe impedir (responder el propio mensaje, publicar sin confirmar, perder un trabajo al reiniciar, mandar un dato a otro dominio) y falla si lo logra. Cada prohibición cita su origen: una restricción de MASTER-SPEC §4, una decisión de `USER-DECISIONS.md` o una perilla de un informe.

**Una comprobación corre en las condiciones de la aplicación o no prueba lo que dice probar.** La base es SQLite real en un archivo efímero con las mismas migraciones y los mismos `PRAGMA`; la API se levanta entera con Fastify en memoria (`app.inject`) o en un puerto libre; el worker es el de verdad. Los dobles existen sólo para los proveedores de modelo (`src/providers/fake.js`) y para el harness externo, porque son terceros con costo.

**Nada se declara funcionando sin haberse ejecutado**, y un reintento repite sólo lo que falló.

## Pila de pruebas

| Capa | Herramienta | Qué protege | Justificación |
|---|---|---|---|
| 1. Contrato | El OpenAPI generado de los esquemas de ruta (`GET /api/openapi.json`) más una prueba que falla si una ruta queda sin esquema de respuesta; el panel compila sus tipos contra ese contrato | §4.11: la API es la única puerta y otro frontend sólo rehace vistas | El contrato primero, generado y no escrito aparte, para que no envejezca |
| 2. Prohibiciones | `node --test` sobre la API entera y SQLite real | §4 completo, reglas de dominio de §1.1, idempotencia de §1.3 | Es la batería; sin dependencias fuera de Node |
| 3. Propiedades | `fast-check` sobre funciones puras: numeración de unidades, aritmética de conjuntos del puntaje, fusión de trozos de audio, reclamo de la cola bajo concurrencia | Invariantes que un ejemplo no cubre (solapes y huecos con miles de particiones aleatorias) | Encuentra lo que el caso escrito a mano no ve |
| 4. Banco de referencia | `bench/` con promptfoo fijado y `bench/score.js` | §1 (el vector): velocidad y descomposición correcta, medidas contra el modelo real | Es el único lugar donde se mide el modelo de verdad; corre a pedido y antes de cambiar modelo, plantilla o esfuerzo |
| 5. Recorrido | Playwright headless contra la imagen Docker levantada con `compose.yml` y proveedores falsos por variable de entorno | El flujo principal de §6 de punta a punta: entrar, enviar con adjuntos, ver el progreso, corregir la propuesta, publicar, responder, cerrar | Es funcional, no visual; las capturas se miran con los ojos en la revisión de pantalla, no se comparan por píxel |
| 6. Unidad | `node --test` para funciones puras | Validadores, parseo de plantillas, `config` | Sin dobles de infraestructura en esta capa |

Lo que no entra, y por qué: Jest (CJS, transformaciones para ESM; `node:test` es nativo), Pact (flujo consumidor primero, secuencial; el contrato ya es el OpenAPI generado), pruebas visuales por comparación de píxeles (dieron más daño que beneficio en un proyecto anterior del autor; una pantalla se aprueba mirándola). Mutación (Stryker) queda para cuando la batería supere las 300 prohibiciones: audita que las pruebas generadas detecten defectos deliberados.

## Disparadores automáticos

| Disparador | Qué corre |
|---|---|
| Cualquier cambio bajo `src/` | `npm test` (capas 2, 3 y 6; menos de un minuto) |
| Cambio en `src/api/` o en un esquema de ruta | Capa 1 y la compilación de tipos del panel |
| Cambio en `src/analyze/`, `templates/`, `src/providers/` o en una perilla de modelo | Capa 4 con el proveedor falso; con el real antes de fusionar, y la tabla antes y después en `docs/investigaciones/mediciones/` |
| Cambio en `panel/` | `npm test` del panel y el recorrido de capturas; las capturas se miran |
| Cambio en `Dockerfile`, `compose.yml` o `scripts/` | Capa 5 completa |
| Cierre de cualquier tarea | Lo que la tarea toca, según las filas de arriba; nunca «por si acaso» la batería entera |

## Prohibiciones de alta prioridad

Cada una protege una restricción de MASTER-SPEC §4 o una regla de §1.1. El verificador dice quién juzga: 🤖 la batería, 🧑 una persona, 🤖🧑 la batería con cierre humano.

| ID | Prohibición | Origen | Verificador |
|---|---|---|---|
| HP-001 | Ningún dato sale del contenedor salvo al proveedor configurado: toda salida de red del servidor y del panel va a `connect-src 'self'` o a la URL del proveedor; una llamada a otro host falla la prueba | §4.1 | 🤖 |
| HP-002 | Cada llamada a un proveedor deja una fila en `llm_calls` con proveedor, modelo, modalidad, tokens y costo; un análisis sin filas falla | §4.1 | 🤖 |
| HP-003 | Ningún `if`, expresión regular ni lista de palabras sobre texto humano decide área, destinatario ni estado: una prueba de código estático falla si `src/analyze/` o `src/domain/` comparan el texto del input contra literales para decidir | §4.2, §1.2 | 🤖 |
| HP-004 | Un trabajo sobrevive al reinicio: se mata el proceso a mitad de un análisis y, al arrancar, el trabajo se retoma y termina | §4.3 | 🤖 |
| HP-005 | Nada llega al equipo sin confirmar: no existe ruta que cree mensajes desde una propuesta sin pasar por `POST /inputs/:id/publish` con sesión del emisor | §4.4, UD-003 | 🤖 |
| HP-006 | Un contenedor y un volumen bastan: `compose.yml` tiene un solo servicio; la imagen arranca sin red salvo al proveedor y responde `/health` | §4.5 | 🤖 |
| HP-007 | Ninguna credencial en el repositorio ni en la base: el gancho de pre-commit y una prueba sobre el esquema (ninguna columna guarda una llave) | §4.6 | 🤖 |
| HP-008 | Identificadores en inglés y comentarios en español: una prueba estática sobre `src/` | §4.7, UD-005 | 🤖 |
| HP-009 | El emisor no responde su propio mensaje (403) y cualquier miembro cierra o reabre: lo impone la API, probado con dos sesiones | §4.8, §1.1 | 🤖 |
| HP-010 | Todo número de operación nace declarado: una prueba estática falla ante un literal numérico en `src/` fuera de `config.js` que no cite su fuente en un comentario de la misma línea | §4.9 | 🤖 |
| HP-011 | Toda dependencia es compatible con MIT: la prueba lee `package.json` y las licencias instaladas | §4.10, UD-004 | 🤖 |
| HP-012 | Ninguna ruta sin esquema de respuesta; el OpenAPI generado valida contra su propio esquema | §4.11 | 🤖 |
| HP-013 | Un mismo input no crea un segundo trabajo ni una segunda propuesta: dos envíos iguales devuelven el mismo id | §1.3 | 🤖 |
| HP-014 | Una propuesta inválida (área inexistente, miembro inexistente, adjunto ajeno, unidad fuera de todo mensaje y de `discarded`) no se publica | §7.5 | 🤖 |
| HP-015 | Un miembro no ve Áreas ni Proveedores y la API devuelve 403 en esas rutas | UD-007 | 🤖 |
| HP-016 | La sesión es opaca y la cookie lleva `__Host-`, `HttpOnly`, `Secure`, `SameSite`; un método no seguro sin la cabecera propia y sin `Sec-Fetch-Site` válido devuelve 403 | §7.7 | 🤖 |
| HP-017 | El flujo SSE repone sin repetidos ni huecos al reconectar con `Last-Event-ID` | §7.10 | 🤖 |
| HP-018 | Un video de más de 20 minutos o un adjunto de más de 24 MB se rechaza con su código antes de encolar | §7.4 | 🤖 |
| HP-019 | La descomposición de los siete casos del banco cubre el 100 % de las unidades con el proveedor real, y la mediana queda bajo el objetivo del vector | §1, §7.11 | 🤖🧑 |
| HP-020 | Cada pantalla se ve como la especificación §6 dice, mirada en captura por alguien distinto de quien la escribió | §6 | 🧑 |

## Pruebas de regresión

Se agrega una fila cada vez que un defecto encontrado en uso real o en el banco se arregla. La prueba reproduce el defecto y falla si vuelve.

| ID | Defecto original | Prueba de regresión | Fecha |
|---|---|---|---|
| REG-001 | Un mensaje de chat de un párrafo con cuatro puntos («1) … 2) … 3) … 4) …») se contó como una sola unidad y salió como un solo mensaje de error (primera corrida real, 16,3 s) | Las unidades bajan a oración y a ítem de enumeración en línea; ese input produce cuatro unidades y cuatro mensajes en tres áreas con el proveedor falso (`src/analyze/regressions.test.js`) | 2026-10-20 |
| REG-002 | Una matriz de retroalimentación con cuatro tablas markdown de 20 a 40 filas quedó en 4 unidades de 2 a 10 KB (banco privado) | Cada fila de tabla es una unidad (`p3.r12`) y la cabecera viaja una vez como contexto, no como unidad; una tabla grande se parte por filas y cada trozo lleva su cabecera (`src/analyze/regressions.test.js`) | 2026-10-20 |
| REG-003 | El chat de WhatsApp «[15:55, 7/10/2026] Nombre: …» no se reconocía (la marca de tiempo exigía un espacio tras mm:ss y acá sigue una coma) y varias líneas de chat se fundían en una unidad (banco privado) | Cada línea de chat es una unidad, el emisor queda en `unit.sender`, una línea sin prefijo sigue al mensaje de su emisor y la coma tras la hora cuenta como marca de tiempo (`src/analyze/regressions.test.js`) | 2026-10-20 |
| REG-004 | En un chat que explicaba cómo debía ser un widget, el analizador descartó todas las unidades como «sin pedido ni falla» y perdió un encargo de implementación con plazo (banco privado) | La clasificación recibe que describir lo que hay que construir es nueva funcionalidad y que un plazo o una fecha comprometida no se descarta (prueba del texto del prompt); con el proveedor real, un chat que describe un widget sale como nueva funcionalidad con su plazo, y la prueba falla 3 de 3 sin la corrección (`src/analyze/regressions.live.test.js`, solo con `ANTHROPIC_API_KEY`) | 2026-10-20 |
| REG-005 | Una nota de voz de 107 s quedó en 46 unidades de una frase corta cada una («Eso.», «pues cachai»): el analizador descartaba o pegaba fragmentos, partía mensajes (33 % en un caso) y la cobertura estricta cayó a entre 0 y 33 % (banco privado) | El extractor une segmentos consecutivos que no cierran oración y tienen una pausa menor a `audio.pauseSeconds` (0,5 s), sin cruzar la frontera entre trozos y con tope de `audio.maxUnitWords`; once segmentos por frase dan cuatro unidades, cada una una oración, y una línea unida no se parte por oración (`src/analyze/regressions.test.js`, `src/extract/lib/sentences.test.js`, `src/extract/audio.test.js`). Medición en `docs/investigaciones/mediciones/2026-10-20-unidades-de-audio.md` | 2026-10-20 |

## Política de recorrido (capa 5)

Se activa cuando cambia un flujo visible (§6), el empaquetado o la identidad. No se activa por un cambio interno que la batería ya cubre. Alcance: el flujo principal de §6 completo, con un adjunto de cada tipo y proveedores falsos por variable de entorno, sobre la imagen Docker.

## Métricas

| Métrica | Valor actual | Objetivo |
|---|---|---|
| Prohibiciones de alta prioridad en verde | 0/20 (la batería se escribe cuando entre el núcleo) | 20/20 |
| Pruebas en `main` | 209 (extractores, proveedores, analizador) + 56 (banco) + 21 (panel) | crece |
| Casos del banco con cobertura 100 % contra el modelo real | 4/7 (corrida 2026-10-21T01:44Z) | 7/7 |
| Mediana de tiempo por caso del banco | 6,8 s a 33,9 s | bajo 10 s salvo el docx de 40 puntos |
