# Método de reparto

Procedimientos para configurar áreas, plantillas y perfiles de un equipo con lo que ese equipo ya escribió y dijo. Incluye cómo juzgar después si el reparto y el trabajo fueron adecuados. Cada procedimiento tiene un guion que lo ejecuta y una prueba con un equipo inventado (`bench/fixtures/area-method/`).

| Paso | Guion | Entrada | Salida |
|---|---|---|---|
| Extraer pedidos | `scripts/request-rows.mjs` | textos del equipo (`units.jsonl`), `team.json` | una fila por pedido (`rows.jsonl`) |
| Medir las áreas candidatas | `scripts/area-method.mjs analyze` | filas, `team.json` | informe con cuatro criterios por área |
| Proponer la configuración | `scripts/area-method.mjs propose` | filas, `team.json`, `purposes.json` | archivo de carga (áreas, plantillas, perfiles) |
| Medir el reparto | `scripts/route-experiment.mjs` | filas, archivo de carga, `team.json` | aciertos de área y de persona, confusiones, indicadores |

## 1. Describir un espacio

Una descripción dice dónde puede moverse quien la lee y deja la decisión a su criterio. Una regla suelta queda en la zona del contexto que el modelo atiende menos y no dice por qué existe. Una descripción con su tensión nombrada obliga a entender cada polo por el otro. El método usa un vocabulario único para áreas, plantillas, perfiles y proyecto.

| Cláusula | Pregunta que responde | Es de pasa o no pasa |
|---|---|---|
| Propósito | Para qué existe, en una oración. Desempata entre dos diseños que cumplen todo | No |
| Se maximiza | La cualidad que gana cuando hay que elegir | No |
| Se sacrifica | Lo que puede quedar apenas suficiente | No |
| Entorno | Hechos que no cambian: quién pide, con qué urgencia, qué se deshace y qué no | No |
| Límites | Lo que nunca se cruza, con el mecanismo que lo hace cumplir | Sí |

Sólo el límite es booleano. El producto lo guarda como `guards` del área (texto, mecanismo y si lo levanta una persona) y el analizador devuelve cuáles toca cada mensaje (`guards_touched`). Todo lo demás son estimaciones continuas con su razón (`src/domain/assessment.js`). `understand_vs_create` e `irreversibility` van de 0 a 1. `value_holder` dice si el valor que falta es de una persona o del modelo.

Reglas de forma:

| Regla | Razón |
|---|---|
| El espacio se escribe en afirmativo; la negación queda para el límite | Una negación puede desviar al modelo en los primeros tokens |
| Un límite que depende de que el modelo lo recuerde necesita un mecanismo: un gancho, una credencial acotada, una prueba | Escribir «no hagas X» no impide X |
| Cada cláusula se escribe con las palabras del dominio del equipo, sin jerga de método | El modelo debe leer lo que el equipo diría |
| El reparto no usa niveles ni tipos cerrados | Un casillero decide antes de mirar el trabajo; una estimación continua con su razón y un juicio posterior no |

## 2. Material de partida

El equipo aporta tres cosas. Ninguna sale del repositorio.

**Unidades** (`units.jsonl`): un texto por línea con `id`, `source`, `date`, `author`, `confidential` y `text`. Valen mensajes, documentos de retroalimentación, decisiones registradas, correcciones al agente y transcripciones. Se recomiendan cuatro semanas o más. `confidential` es obligatorio y booleano en cada unidad. Una unidad sin él se rechaza: «abierto» por omisión es la forma en que una reunión grabada llega a una salida. Una reunión grabada lleva `confidential: true`.

Las filas de una unidad confidencial suman a los conteos, las medias y las proporciones. Eso incluye el tamaño, quién pide y los límites tocados. Ninguna palabra suya llega a una salida. Eso excluye las frases de «Se maximiza» y «Se sacrifica», los ejemplos, los nombres de módulos y de intenciones, y el título de un área. Vale para el informe de `analyze`, el archivo de carga, la lista de áreas descartadas y los perfiles. Una prueba siembra frases únicas en filas confidenciales y verifica que no aparecen.

Un área con más de la mitad de sus filas confidenciales (`--max-confidential-share`) no se propone y en toda salida se llama «Área confidencial N». La red de privacidad de la extracción reemplaza correos y cifras largas. No detecta nombres de personas ni de empresas, así que una persona lee las filas de una unidad confidencial antes de correr `propose`. Un lote de extracción nunca mezcla unidades confidenciales con abiertas.

**Equipo** (`team.json`):

```json
{
  "members": [{ "email": "ana@ejemplo.org", "name": "Ana", "kind": "person", "role": "Soy ... (una o dos oraciones propias)" }],
  "limits": [{ "id": "money", "text": "mover dinero o fijar un precio", "person": true }]
}
```

`kind` es `person` o `agent`. `person` en un límite indica que lo levanta una persona. El `id` usa minúsculas, dígitos y `_`, porque nombra un campo booleano de salida.

**Propósitos** (`purposes.json`): `{ "Título del área": "oración" }`. El propósito es del equipo y no se deduce del corpus; `propose` se detiene si falta.

### Filas

`request-rows.mjs` pide a un modelo liviano, por lotes de unos 18.000 caracteres, una fila por pedido con salida validada por esquema. Cada lote queda en la carpeta de `--cache` y un corte no repite lo hecho. Un resumen con correo o con una cifra larga se reemplaza y se cuenta.

| Campo | Contenido |
|---|---|
| `unit`, `date`, `source`, `confidential` | origen del pedido |
| `who`, `to` | miembro que pide y miembro a quien va, o `other` |
| `summary` | una línea abstracta, sin datos personales |
| `intent`, `object`, `module` | lo que se quiere lograr, parte del sistema o del negocio, parte concreta; texto libre, una a tres palabras |
| `understand_vs_create` | 0 comprender o aplicar lo conocido, 1 crear (Anderson y Krathwohl, 2001, usada como escala) |
| `severity`, `irreversibility` | 0 a 1: qué colapsa si se hace mal y si se deshace |
| `missing_value`, `value_holder` | 0 a 1 de cuánto del valor que falta es de una persona, y quién lo tiene (`model` o `nobody` si no es de una persona) |
| `limits` | ids de los límites del equipo que el pedido toca |
| `maximize`, `sacrifice` | frases de 2 a 8 palabras, vacías si el texto no las deja ver |
| `urgency`, `correction` | 0 a 1, y si corrige algo que ya se hizo mal |

Un pedido exige a una persona cuando `missing_value` pasa de 0,5 y el `value_holder` es una persona, o cuando toca un límite que una persona levanta.

## 3. Conjunto de áreas

```
node scripts/request-rows.mjs units.jsonl --team team.json --out rows.jsonl --cache cache/
node scripts/area-method.mjs labels rows.jsonl
node scripts/area-method.mjs analyze rows.jsonl --team team.json --families families.json --out report.json
```

| Paso | Qué se hace |
|---|---|
| 1 | Extraer las filas |
| 2 | `labels` lista los objetos y las intenciones con su frecuencia. La persona agrupa los objetos en familias que comparten el mismo mapa del sistema (`families.json`: `{ "objeto": "Título del área" }`). Sin archivo, cada objeto es un área |
| 3 | `analyze` mide cada área con los cuatro criterios de abajo |
| 4 | Un área que falla se une a la más cercana en sus dimensiones (`merge_into`) o se redefine; se vuelve al paso 3 |
| 5 | Se mide el reparto (sección 8) con las descripciones |

Un área existe si cumple los cuatro criterios.

| Criterio | Umbral y perilla | Fuente del umbral |
|---|---|---|
| Volumen | al menos 5 % de las filas (`--min-share`) | Con una muestra de 60 pedidos, 5 % son 3 casos, el mínimo para medir el reparto del área |
| Se reconoce por el texto | los límites inferiores de Wilson de su recall y de su precisión superan su proporción en el corpus | Clasificador bayesiano sobre el resumen, sin el módulo, que es parte del objeto del que sale el área. Validación cruzada de 5 pliegues (`--folds`) repetida 10 veces (`--repeats`), con 1,96 desviaciones (`--z`). Los pliegues se arman por unidad: dos pedidos de un mismo mensaje nunca quedan a ambos lados |
| Mapa propio | sus diez módulos más frecuentes comparten a lo más la mitad con los de cada otra área (`--max-overlap`) | Definición: más de la mitad en común es el mismo mapa |
| Tratamiento distinto | su límite dominante difiere del de cada otra área, o alguna dimensión difiere en 0,5 desviaciones estándar o más (`--min-effect`) | Cohen (1988): 0,5 es el efecto mediano |

La proporción es la línea base. Un clasificador que no lee el texto obtiene esa precisión, ya sea que reparta por proporciones o elija siempre el área mayor. Obtiene ese recall si reparte por proporciones. Exigir las dos cotas evita que un área dominante apruebe sólo por absorber todo. El intervalo es el de Wilson (1927) y no el de Wald. Con 3 aciertos de 3, Wald da un límite inferior de 1 y Wilson da 0,44 (Brown, Cai y DasGupta, 2001). El criterio es un diagnóstico del corpus y no del enrutador. Dice si el texto de los pedidos separa las áreas, no si un modelo que lee una descripción las elige bien. Eso lo mide la sección 8.

Medición del 2026-10-26 (`bench/area-method-recognition.mjs`, corpus inventados con una proporción conocida de palabras sin señal). Con texto sin señal, ninguna de las áreas aprueba en 30 corpus, sea cual sea su proporción (70/20/10 y 92/5/3/2). Con señal hasta 0,7 de palabras compartidas, las cuatro áreas de 60, 40, 20 y 12 filas aprueban en los 30 corpus. La franja de transición va de 0,75 a 0,9. Dentro de ella, con una sola partición, entre 2 y 15 de 32 veredictos cambiaban sólo por la semilla de los pliegues. Con 10 repeticiones cambian entre 0 y 5. Con esa evidencia el criterio se conserva.

El informe incluye por área su perfil. Lleva tamaño, pedidos por semana, medias de las dimensiones y fracción que exige a una persona. Lleva también quién pide, quién tiene el valor, los límites más tocados, lo que se maximiza y se sacrifica, los módulos y las intenciones. Con las mismas filas el informe es idéntico: las particiones usan una semilla fija.

Cuándo cambia el conjunto. Nace un área cuando un subconjunto de otra cumple los cuatro criterios por separado en dos corridas seguidas, para que una sola corrida no decida. Se une a otra si baja del umbral de volumen en dos corridas seguidas. También se une si el enrutador la confunde con esa otra en más casos de los que acierta. Se repite la medición al sumar un miembro y cuando el equipo cambia lo que hace.

## 4. Descripción de un área

`propose` arma cada descripción con las cláusulas de la sección 1. El propósito viene de `purposes.json`; el resto sale del perfil del área.

| Cláusula | Cómo se obtiene |
|---|---|
| Se maximiza | Hasta tres frases representativas de `maximize` de las filas no confidenciales: la palabra más repetida elige la frase más frecuente que la contiene, y esa palabra sale de la ronda siguiente |
| Se sacrifica | Lo mismo con `sacrifice` |
| Entorno | Los dos miembros que más piden, con su porcentaje, y la fracción que exige a una persona |
| Límites | Hasta tres límites más tocados, cada uno con quién lo levanta |
| Entra | Hasta tres resúmenes, uno por módulo frecuente, de filas no confidenciales |
| No entra | Las áreas con que el reconocimiento por texto más la confunde |

La descripción tiene a lo más 1.024 caracteres (`TEMPLATE_DESCRIPTION_MAX`). Si no cabe, se quitan primero los ejemplos, luego el borde y luego el entorno. Las cláusulas con propósito, qué se maximiza, qué se sacrifica y límites no se quitan: si ellas solas no caben, `propose` se detiene.

Una descripción de cuatro cláusulas separa mejor los casos de borde que una línea: la línea no tiene espacio para la excepción. La corrección de una descripción nombra el borde con el vecino sólo cuando la medición muestra una confusión de dos casos o más.

## 5. Plantillas por área

Una plantilla por intención con 20 pedidos o más dentro del área (`--min-template`). Con 20 pedidos, el error estándar de la media de una dimensión es 0,22 desviaciones (1 / √20). Las intenciones con menos pedidos se atienden con la plantilla más cercana del área. `--intents` agrupa etiquetas de intención en un solo nombre de plantilla.

Campos comunes, porque deciden el reparto y no se deducen del área:

| Campo | Contenido |
|---|---|
| `request` | qué se pide |
| `value_missing` | qué falta y de quién es el valor; texto libre, nadie si nada falta |
| `limits_touched` | límites que toca y quién los levanta |
| `undo` | cómo se deshace y cuánto cuesta (opcional) |

Los campos propios de una intención salen de lo que los pedidos de ese subconjunto traían o les faltaba, y se entregan en `--intent-fields` (`{ "Falla": [{ "name": "steps", "label": "Pasos para reproducir", "required": true }] }`). El bloque `output` lleva un campo booleano `touches_<id>` por cada límite del área: es lo único booleano. La sección «Salida» del cuerpo repite qué se maximiza, qué se acepta perder y dónde se detiene la sesión.

## 6. Perfil de un miembro

`propose` redacta un borrador en primera persona con lo que el corpus dice del miembro; la persona lo corrige.

| Parte | Origen |
|---|---|
| Qué hace | La oración `role` de `team.json`, escrita por el propio miembro o por el equipo |
| Qué maximiza y qué acepta perder | Frases de los pedidos que hizo (persona) o que recibió (agente) |
| Dónde pide, o cómo se reparte lo que atiende | Áreas con su porcentaje |
| Qué decide | Pedidos donde él tiene el valor que falta, por área, y los límites de persona que más levanta |
| Qué no decide (agente) | Los límites que levanta una persona |

Las reuniones confidenciales aportan sólo conteos y ninguna frase suya entra a un perfil. Un perfil nombra sólo las áreas del archivo de carga. El perfil de una persona calibra el tono y el grado de guía. El reparto lo decide el valor que falta en cada pedido, porque quién pide explica poco de cómo se atiende. Un perfil no supera `config.members.profileMaxLength` (4.000 caracteres).

## 7. Descripción del proyecto

Texto de la descripción del proyecto, con las mismas cláusulas.

| Cláusula | Pregunta |
|---|---|
| Propósito | Por qué existe el proyecto |
| Se maximiza | Qué gana entre dos diseños que cumplen todo |
| Se sacrifica | Qué no persigue |
| Entorno | Hechos que no cambian: quién construye, qué está en producción, qué tope de gasto rige |
| Límites | Lo que nunca se cruza, con su mecanismo |

Criterio de aceptación: un modelo que lee sólo esta descripción y un pedido de las filas nombra el límite en juego. Se cuenta cuántas veces coincide con `limits` de la fila en una muestra de 20 pedidos; el equipo fija la proporción antes de medir.

## 8. Medir el reparto

```
node scripts/route-experiment.mjs rows.jsonl --load load.json --team team.json --sample 60 --judge --out result.json
```

Un enrutador liviano lee sólo las descripciones de las áreas y los perfiles, y cada pedido de la muestra. Devuelve área, quién atiende y un encargo de una línea. El resultado se compara con la fila sin juez.

| Medida | Definición |
|---|---|
| `area_match` | El área elegida es la de la fila |
| `person_match` | Se incluye a la persona que tiene el valor exactamente cuando la fila exige a una persona |
| `person_extra`, `person_missing` | Se agregó una persona que no hacía falta, o faltó la que hacía falta |
| `confusions` | Pares de áreas que el enrutador confunde, con su conteo |
| `indicators` | Con `--judge`, el promedio de cuatro indicadores de la evaluación del trabajo (1.1, 1.2, 2.3, 3.3) de −2 a +2 |

La muestra es de 60 pedidos: una proporción medida con 60 tiene un margen de unos 0,13 con 95 % de confianza. Sirve para distinguir 0,5 de 0,8 y no para distinguir 0,8 de 0,85. Una diferencia de un caso entre dos descripciones queda dentro del ruido. `--accept <proporción>` hace fallar el comando si el área o la persona quedan por debajo. Sin él sólo se informan los números, porque el umbral es del equipo. La cuota que gasta una corrida se lee en el informe de uso del proveedor.

Se corrige la descripción donde hay una confusión de dos casos o más. Se prueba primero sobre esos casos y después sobre toda la muestra. Se detiene cuando una versión nueva ya no mejora el área ni la persona.

## 9. Prueba con un miembro nuevo

Los procedimientos se replican con alguien de quien sólo hay una reunión de incorporación y sus mensajes.

| Paso | Qué se hace | Criterio |
|---|---|---|
| 1 | Agregar sus unidades y extraer sus filas | Cada pedido con sus dimensiones |
| 2 | Correr `analyze`: sus pedidos caen en las áreas existentes o piden una nueva con los cuatro criterios | Si cumple los cuatro nace el área; si no, su trabajo entra al área más cercana |
| 3 | Redactar su perfil con `propose` y corregirlo con la persona | Ninguna palabra de la reunión en el perfil |
| 4 | Correr el experimento con 20 pedidos donde el valor es suyo y 20 donde no | Lo incluye cuando el valor es suyo y no lo incluye en los otros; el umbral lo fija el equipo |
| 5 | Comparar su perfil completo con uno de una línea en la misma corrida | El completo no puntúa menos en los indicadores |
| 6 | Pedir a la persona que marque lo que no la describe | Una corrección por cláusula como máximo |

## 10. Evaluación del trabajo

Al terminar un trabajo, el proveedor de texto lo juzga con una rúbrica de doce indicadores en cuatro ejes (`src/execute/judge.js`). Responde qué tan adecuado fue lo que se hizo, que las estimaciones del analizador sólo anticipan.

| Eje | Indicadores |
|---|---|
| 1. Alineación estratégica | 1.1 claridad estratégica, 1.2 especificación del problema, 1.3 propósito central |
| 2. Integridad del artefacto | 2.1 fiabilidad funcional, 2.2 integridad bajo presión, 2.3 precisión y conformidad (incluye los límites del área) |
| 3. Eficiencia del proceso | 3.1 utilización de recursos, 3.2 bienestar del colaborador, 3.3 calidad del esfuerzo cognitivo |
| 4. Colaboración y transparencia | 4.1 transparencia del razonamiento, 4.2 intervención crítica, 4.3 resultado final por encima de la primera propuesta viable |

Cómo se lee:

| Regla | Detalle |
|---|---|
| Escala | −2 inaceptable, −1 bajo, 0 esperado, +1 fuerte, +2 excepcional. El 0 es el mínimo aceptable y no un punto medio |
| Evidencia | Cada puntaje lleva una cita del trabajo, una afirmación y su razonamiento |
| Lo que no aplica | Un indicador que no se puede observar en un trabajo sin supervisión lleva `applies: false` y queda fuera de su eje; nunca se rellena con 0 |
| Meta del eje | La da el cuadrante de la tarea (generar, elegir, negociar, ejecutar): un eje cumple cuando su media alcanza la meta de ese cuadrante |
| Sin total | No hay puntaje único por trabajo. Se compara eje por eje y entre trabajos del mismo cuadrante |

Usos al configurar:

| Pregunta | Dónde se lee |
|---|---|
| ¿El modelo liviano alcanza en esta área? | Los ejes de los trabajos juzgados por área y por modelo. Un eje bajo la meta en el modelo liviano y sobre ella en el mayor mueve el área al mayor |
| ¿Una descripción de área genera trabajo adecuado? | El indicador 1.1 y 1.2 de los trabajos del área antes y después de cambiar la descripción |
| ¿Un límite se respeta? | El indicador 2.3 y el campo `touches_<id>` de la salida |

El límite del modelo liviano se fija con trabajos juzgados y no con una lista corta de casos triviales. La escalada al modelo mayor es por falla comprobada y no por pasos (`bench/model-limits.mjs`, `src/execute/judge.js`).

## 11. Archivo de carga

`propose` escribe el archivo que carga el cargador de configuración del repositorio. Es idempotente: crea o actualiza por título de área y por nombre de plantilla, y aplicarlo dos veces deja el mismo estado.

```json
{
  "version": 1,
  "actor": "ana@ejemplo.org",
  "areas": [{ "title": "Catálogo y precios", "description": "…", "position": 2, "templates": [{ "name": "Ajuste", "description": "…", "body_markdown": "---\nname: …\n---\n…" }] }],
  "members": [{ "email": "ana@ejemplo.org", "profile": "…" }]
}
```

| Campo | Regla |
|---|---|
| `actor` | Correo del miembro que registra la auditoría; es opcional en la propuesta y obligatorio al cargar |
| `areas[].templates[]` | `body_markdown` es una plantilla válida (`src/analyze/templates.js`); `name` y `description` salen de su encabezado |
| `members[]` | Un miembro existente, por correo |
| `validateLoadFile` | Rechaza una plantilla que no se lee, un área o una plantilla repetidas y un miembro sin correo |

La prueba `scripts/area-method.test.mjs` crea con las funciones del dominio (`createArea`, `createTemplate`, `updateMember`) lo que describe una propuesta sobre el equipo inventado.

## 12. Perillas

| Perilla | Omisión | Fuente |
|---|---|---|
| `--min-share` | 0,05 | 3 casos de una muestra de 60 |
| `--min-effect` | 0,5 | Cohen (1988), efecto mediano |
| `--max-overlap` | 0,5 | Definición de mapa compartido |
| `--min-template` | 20 | Error estándar de 0,22 desviaciones |
| `--z` | 1,96 | Percentil 97,5 de la normal |
| `--folds` | 5 | Validación cruzada de 5 pliegues |
| `--repeats` | 10 | Medición del 2026-10-26: con 1 partición, 2 a 15 de 32 veredictos cambiaban sólo con la semilla; con 10, 0 a 5 |
| `--map-size` | 10 | Los diez módulos más frecuentes definen el mapa; una lista más larga llega a módulos que aparecen una vez |
| `--person-value-above` | 0,5 | Definición: el valor que falta es de una persona cuando pasa de la mitad de la escala |
| `--seed` | 7 | Semilla fija para repetir el informe |
| `--max-confidential-share` | 0,5 | Definición: un área está sustentada por filas confidenciales cuando son más de la mitad de las suyas |
| `--sample` (experimento) | 60 | Margen de 0,13 con 95 % de confianza |
