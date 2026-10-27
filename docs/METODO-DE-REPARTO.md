# Método de reparto

Procedimientos para configurar áreas, plantillas y perfiles de un equipo con lo que ese equipo ya escribió y dijo. Incluye cómo juzgar después si el reparto y el trabajo fueron adecuados. Un procedimiento con guion tiene su prueba con un equipo inventado (`bench/fixtures/area-method/`). Los que no tienen guion se marcan «manual» y traen su procedimiento.

| Paso | Guion | Entrada | Salida | Automatizado |
|---|---|---|---|---|
| Extraer pedidos | `scripts/request-rows.mjs` | textos del equipo (`units.jsonl`), `team.json` | una fila por pedido (`rows.jsonl`) | Sí |
| Validar las filas | `scripts/row-validation.mjs` | filas, etiquetas de personas | muestra para etiquetar, acuerdos (kappa) | La muestra y los acuerdos; las etiquetas las ponen personas |
| Medir las áreas candidatas | `scripts/area-method.mjs analyze` | filas, `team.json` | informe con cuatro criterios por área | Sí |
| Proponer la configuración | `scripts/area-method.mjs propose` | filas, `team.json`, `purposes.json` | archivo de carga (áreas, límites, plantillas, perfiles) | Sí |
| Confirmar las áreas | ninguno | archivo de carga | las áreas con `confirmed: true` | Manual, sección 5 |
| Cargar | `scripts/apply-load-file.mjs` | archivo de carga confirmado | áreas, límites, plantillas y perfiles en la base | Sí |
| Medir el reparto | `scripts/route-experiment.mjs` | filas, archivo de carga, `team.json` | acuerdo de área y de persona, líneas base, confusiones, indicadores | Sí |
| Probar la descripción del proyecto | ninguno | descripción, filas | proporción de límites nombrados | Manual, sección 8 |
| Probar con un miembro nuevo | ninguno | unidades del miembro | su perfil y su lugar en las áreas | En parte, sección 10 |
| Evaluar un trabajo | `src/execute/judge.js` | un trabajo terminado | juicio de doce indicadores | Sí, dentro del producto |

El proveedor de texto de la extracción y del experimento es `claude -p`, con la suscripción de quien corre el guion y el modelo `claude-haiku-5-5` por omisión (`--model`). La extracción hace una llamada por lote de 18.000 caracteres. El experimento hace una llamada por pedido, y dos con `--judge`. El método no fija un costo: la cuota se lee en el informe de uso del proveedor.

## 1. Describir un espacio

Una descripción dice dónde puede moverse quien la lee y deja la decisión a su criterio. Cumple dos funciones a la vez. Da forma: límites con su mecanismo y una medida de lo que se maximiza. Deja espacio: el propósito y lo que puede quedar apenas suficiente. Una descripción que sólo da forma produce trámite. Una que sólo deja espacio no produce nada comprobable. Cuando lo pedido es explorar una idea, el trabajo se construye y se muestra, y sólo la respuesta de una persona lo publica.

Una regla suelta puede quedar en medio de un contexto largo. Ahí el rendimiento baja (Liu et al., 2023, arXiv:2307.03172, consultado el 2026-10-27). Una descripción con su tensión nombrada obliga a entender cada polo por el otro. El método usa un vocabulario único para áreas, plantillas, perfiles y proyecto.

| Cláusula | Pregunta que responde | Es de pasa o no pasa |
|---|---|---|
| Propósito | Para qué existe, en una oración. Desempata cuando dos opciones sirven igual al propósito | No |
| Se maximiza | Una sola cualidad: la que gana cuando hay que renunciar a algo y dos diseños cumplen todo. Si el corpus muestra dos, el equipo elige una y la otra pasa a lo que se sacrifica o a un límite | No |
| Se sacrifica | Lo que puede quedar apenas suficiente | No |
| Entorno | Hechos que no cambian y acotan las soluciones: herramientas obligatorias, plazos, presupuesto, qué está en producción, qué se deshace y qué no. Cuánto pide cada persona es un dato del informe y no del entorno | No |
| Límites | Lo que nunca se cruza, con el mecanismo que lo sostiene | Sí |

Sólo el límite es booleano. El producto lo guarda como `guards` del área (texto, mecanismo y si lo levanta una persona) y el analizador devuelve cuáles toca cada mensaje (`guards_touched`). Todo lo demás son estimaciones continuas con su razón (`src/domain/assessment.js`). `understand_vs_create` e `irreversibility` van de 0 a 1. `value_holder` es `person` o `model` y dice de quién es el valor que falta.

Levantar un límite de una persona sigue siempre este orden (UD-313):

| Paso | Qué ocurre |
|---|---|
| 1 | Un límite de una persona, tocado y sin levantar, retiene la entrega. La plataforma la deja pendiente de aprobación (`pending_delivery`, el mismo efecto del código 76) y traspasa el mensaje a quien decide en el área |
| 2 | La sesión nombra el límite que toca y el riesgo si se cruza, y propone una alternativa que hace lo pedido sin cruzarlo. Puede preparar el trabajo en la rama |
| 3 | Una persona activa lo levanta al aprobar la entrega a mano o con `review: approve` en el hilo. La aprobación de antemano y la de un agente no lo levantan |
| 4 | Queda en la auditoría como `message.guard_lifted`: quién, qué límites y qué entrega |
| 5 | Vale para ese mensaje y no para los siguientes |

El sistema lee ids y quién aprueba, nunca la prosa de la sesión. Un límite que no es de persona no se retiene en la plataforma: lo sostiene su mecanismo.

Reglas de forma:

| Regla | Razón |
|---|---|
| El espacio se escribe en afirmativo; la negación queda para el límite | Los modelos manejan peor la negación (Truong, Baldwin, Verspoor y Cohn, 2023, arXiv:2306.08189, consultado el 2026-10-27) |
| Un límite que depende de que el modelo lo recuerde necesita un mecanismo: un gancho, una credencial acotada, una prueba | Escribir «no hagas X» no impide X |
| Cada cláusula se escribe con las palabras del dominio del equipo, sin jerga de método | El modelo debe leer lo que el equipo diría |
| Qué modelo trabaja, quién atiende y cómo se trabaja no se lee de una categoría: salen de estimaciones continuas con su razón y de un juicio posterior. Las áreas y las plantillas sólo eligen qué descripción y qué campos se muestran, y se redefinen cuando la medición lo pide (sección 4) | Un casillero decide antes de mirar el trabajo. El cuadrante del juicio (sección 11) clasifica la tarea para fijar metas de evaluación y no decide a quién ni cómo se asigna |

## 2. Material de partida

El equipo aporta tres cosas. Ninguna sale del repositorio.

**Unidades** (`units.jsonl`): un texto por línea con `id`, `source`, `date`, `author`, `confidential` y `text`. Valen mensajes, documentos de retroalimentación, decisiones registradas, correcciones al agente y transcripciones. El corpus necesita filas y no semanas: al menos 26 por área y por ventana de tiempo (secciones 3 y 4). El informe avisa con `corpus_small` cuando no alcanza. El método no trae exportador. Cada texto de un chat o de una reunión se exporta con la herramienta de su origen y se escribe como una línea de `units.jsonl`. Una unidad en dos idiomas pide un paso explícito: la persona unifica las etiquetas de `labels` en `families.json`. `confidential` es obligatorio y booleano en cada unidad. Una unidad sin él se rechaza: «abierto» por omisión es la forma en que una reunión grabada llega a una salida. Una reunión grabada lleva `confidential: true`.

Las filas de una unidad confidencial suman a los conteos, las medias y las proporciones. Eso incluye el tamaño, quién pide y los límites tocados. Ninguna palabra suya llega a una salida. Eso excluye las frases de «Se maximiza» y «Se sacrifica», los ejemplos, los nombres de módulos y de intenciones, y el título de un área. Vale para toda salida de los tres guiones. Eso incluye el informe de `analyze` y sus ventanas, el archivo de carga, las áreas descartadas, los perfiles, la muestra de validación y el experimento. `labels` oculta las etiquetas que sólo usan filas confidenciales. Una prueba siembra frases únicas en filas confidenciales y verifica que no aparecen en ninguna. El experimento no enruta pedidos de unidades confidenciales, porque el enrutador reescribe el pedido en su encargo, y cuenta cuántos dejó fuera (`sample.confidential_left_out`).

Un área con más de la mitad de sus filas confidenciales (`--max-confidential-share`) no se propone y en toda salida se llama «Área confidencial N». La red de privacidad de la extracción reemplaza correos y cifras largas. No detecta nombres de personas ni de empresas, así que una persona lee las filas de una unidad confidencial antes de correr `propose`. Un lote de extracción nunca mezcla unidades confidenciales con abiertas. La extracción sí envía el texto de las unidades confidenciales al proveedor del modelo: la prohibición es sobre las salidas y no sobre ese envío. Los resúmenes de filas abiertas se citan en las descripciones («Entra: …») y por eso la lectura previa de la persona cubre también esas filas.

**Equipo** (`team.json`):

```json
{
  "members": [{ "email": "ana@ejemplo.org", "name": "Ana", "kind": "person", "role": "Soy ... (una o dos oraciones propias)" }],
  "limits": [
    { "id": "money", "text": "mover dinero o fijar un precio", "person": true },
    { "id": "customer_data", "text": "datos personales de clientes", "person": false, "mechanism": "la credencial del asistente no lee la tabla de clientes" }
  ]
}
```

`kind` es `person` o `agent`. `person` en un límite indica que lo levanta una persona. El `id` usa minúsculas, dígitos y `_`, porque nombra un campo booleano de salida.

`mechanism` es el gancho, la credencial acotada o la prueba que sostiene un límite que no levanta una persona. Un límite de persona lo sostiene la plataforma, que retiene la entrega hasta que una persona lo levanta (sección 1). Un límite que no es de persona y no declara mecanismo depende de que el modelo lo recuerde. Eso es un pedido y no un límite. Se escribe igual. La descripción dice «sin mecanismo declarado» y `propose` avisa una vez por área. Nunca escribe que el sistema lo hace cumplir.

**Propósitos** (`purposes.json`): `{ "Título del área": "oración" }`, o `{ "Título del área": { "purpose": "oración", "environment": "hechos que no cambian" } }`. El propósito y el entorno son del equipo y no se deducen del corpus; `propose` se detiene si falta el propósito.

### Filas

`request-rows.mjs` pide a un modelo liviano, por lotes de unos 18.000 caracteres, una fila por pedido con salida validada por esquema. Cada lote queda en la carpeta de `--cache` y un corte no repite lo hecho. El archivo se nombra con un hash del contenido del lote, las instrucciones, el esquema, el proveedor y el modelo. Otro texto, otro proveedor u otro modelo nunca encuentra el archivo de una corrida anterior. Cada fila guarda el modelo y la versión del guion (`model`, `script_version`).

La extracción no es determinista: `claude -p` no fija semilla ni temperatura, y dos corridas dan filas distintas. Por eso la sección 3 pide repetirla sobre la muestra validada y medir el acuerdo entre corridas. Un correo o una cifra larga en los textos de una fila se reemplaza y se cuenta. Una fecha ISO se deja.

| Campo | Contenido |
|---|---|
| `unit`, `date`, `source`, `confidential` | origen del pedido |
| `who`, `to` | miembro que pide y miembro a quien va, o `other` |
| `summary` | una línea abstracta, sin datos personales |
| `intent`, `object`, `module` | lo que se quiere lograr, parte del sistema o del negocio, parte concreta; texto libre, una a tres palabras |
| `understand_vs_create` | 0 comprender o aplicar lo conocido, 1 crear (Anderson y Krathwohl, 2001). Es una taxonomía de categorías usada como escala continua, una convención sin validar |
| `severity`, `irreversibility` | 0 a 1: qué colapsa si se hace mal y si se deshace |
| `missing_value` | 0 a 1: cuánto del valor que falta es de una persona. Describe el área y no decide nada |
| `value_holder`, `holder` | `person` o `model`, el vocabulario del analizador del producto, y el nombre de la persona que tiene el valor (vacío si es `model`) |
| `limits` | ids de los límites del equipo que el pedido toca |
| `maximize`, `sacrifice` | frases de 2 a 8 palabras, vacías si el texto no las deja ver |
| `urgency`, `correction` | 0 a 1, y si corrige algo que ya se hizo mal |

Un pedido exige a una persona cuando `value_holder` es `person` o cuando toca un límite que una persona levanta. Es la definición del producto (`touchesPerson`, `src/domain/assessment.js`), sin umbral. Una prueba compara ambas definiciones sobre las mismas combinaciones.

El método se adapta al analizador del producto, no al revés. Estas son las correspondencias entre los campos que el analizador devuelve por mensaje y los que el método mide por fila:

| Analizador del producto | Fila del método |
|---|---|
| `understand_vs_create` | igual |
| `value_holder` (`person` o `model`) | igual, más `holder` con el nombre |
| `guards_touched` (ids de los límites del área) | `limits` (ids de los límites del equipo) |
| `irreversibility`: qué colapsa si se ignora y si se deshace, en una sola escala | `severity` (qué colapsa) e `irreversibility` (si se deshace), separadas |
| `expectation`: lo que se espera del trabajo, en palabras | no se extrae |
| `certainty`: qué tan seguro está el analizador de sus estimaciones | no se extrae |
| `idea`, `idea_guard`, `idea_reason`: cuánto del mensaje es una idea, si aplica el límite de que nada cambia sin aprobación de una persona al explorar una idea, y por qué | no se extraen |
| no existe | `missing_value`, `urgency`, `correction`, `maximize`, `sacrifice`, `intent`, `object`, `module` |

El reparto que mide la sección 9 usa lo que las filas dicen. No mide `certainty` ni el modo exploración, que el producto usa al elegir el modelo y al entregar.

## 3. Validar las filas

Una fila es la estimación de un modelo. Una cifra contra las filas mide cuánto coinciden dos lecturas del mismo texto hechas por el mismo modelo. No es acierto, aunque las filas estén validadas. La coincidencia no acota el acierto en ninguna dirección: un error común a las dos lecturas cuenta como acierto. El acierto sólo se informa contra etiquetas de personas que leyeron el texto original. La anotación con un modelo generativo se valida contra personas (Pangakis, Wolken y Fasching, 2023, arXiv:2306.00176, consultado el 2026-10-27). Un modelo también favorece lo que genera (Panickssery, Bowman y Feng, 2024, arXiv:2404.13076, consultado el 2026-10-27).

```
node scripts/row-validation.mjs sample --units units.jsonl --rows rows.jsonl --team team.json --stage tune --out sample.jsonl
node scripts/row-validation.mjs agree --units units.jsonl --rows rows.jsonl --labels labels.jsonl --team team.json --reference-rater ana --retest rows2.jsonl --out validation.json
```

| Paso | Qué se hace | Automatizado |
|---|---|---|
| 1 | `sample` sortea unidades, no resúmenes. Entrega el id, el origen y la fecha de cada una; el texto queda en `units.jsonl` | Sí |
| 2 | Una persona lee el texto original de cada unidad y lista los pedidos que hay, en el orden del texto: `area`, `value_holder` y `limits` de cada uno. Una unidad sin pedidos lleva una lista vacía. Va en `labels.jsonl`: `{ unit, rater, requests }` | No, la hace una persona |
| 3 | Una segunda persona etiqueta las unidades marcadas `double` | No, la hace una persona |
| 4 | Un desacuerdo entre las dos lo resuelve una lectura de adjudicación, con `rater: "adjudicated"` | No, la hace una persona |
| 5 | Se repite la extracción sobre las mismas unidades (`rows2.jsonl`) | Sí, con `request-rows.mjs` |
| 6 | `agree` calcula lo que la extracción encontró contra lo que encontraron las personas y los acuerdos | Sí |

Muestra. Los estratos son disjuntos. `zero` reúne las unidades donde la extracción no encontró ningún pedido, que es donde se esconde un pedido omitido. Las demás se separan por el límite más raro del equipo que alguno de sus pedidos toca (`limit:<id>`, el de menos unidades) o `none`. Así un límite raro tiene sus propios casos. Cada estrato aporta 26 unidades o todas las que tiene, y 26 unidades se marcan `double`. Ese 26 es el menor n para el que el intervalo de Wilson de una tasa de 0,8 tiene semiancho 0,15 (`--target-rate`, `--half-width`). Con `--stage tune` o `--stage confirm` la muestra sale de las unidades de esa etapa, con la misma partición y la misma semilla que usa el experimento. Hay una muestra para el ajuste y otra para la confirmación. No incluye unidades confidenciales: una persona las lee completas antes de `propose`.

Referencia. Ninguna etiqueta vale por el nombre de quien la puso. `--reference-rater` nombra a la persona que etiquetó toda la muestra, y con dos personas sin ese nombre el guion se detiene. Donde las dos listan los mismos pedidos, la etiqueta se mantiene. Donde difieren, la referencia es la etiqueta de la lectura adjudicada. Sin ella, la unidad queda fuera de la referencia y se cuenta en `reference.unadjudicated`, y mientras haya una la validación no pasa.

Lo que se mide. Por unidad se compara cuántos pedidos listó la persona y cuántas filas escribió la extracción. Los que sobran en las filas están inventados y los que faltan están omitidos. De ahí salen el recall y la precisión de la extracción por pedido, con su intervalo. Donde los números coinciden, los pedidos se emparejan por orden. Cada campo recibe un kappa de Cohen (1960): área, titular del valor, si exige a una persona y cada límite. La definición de «exige a una persona» es la de la sección 2. Una unidad cuyos números difieren no se puede emparejar y se informa como no alineada. Cada unidad pesa lo que pesa su estrato (unidades de la etapa sobre unidades etiquetadas). El intervalo sale de 1.000 remuestreos de unidades dentro de cada estrato (Efron y Tibshirani, 1993). Los pedidos de una unidad comparten texto y autor.

El kappa tiene un intervalo ancho con pocas etiquetas. Con 78 pedidos etiquetados la mitad del intervalo mide 0,15. La medición del 2026-10-27 (`bench/area-method-kappa.mjs`) pasó 300 pares de etiquetas con kappa verdadero conocido por una compuerta de 0,6:

| Kappa verdadero | Pasa si se mira el valor puntual | Pasa si se mira el límite inferior |
|---|---|---|
| 0,5 | 0,10 | 0,00 |
| 0,6 | 0,51 | 0,03 |
| 0,7 | 0,92 | 0,32 |
| 0,8 | 1,00 | 0,86 |

Por eso la compuerta mira el límite inferior de cada kappa, y exige que llegue a 0,6 (`--min-kappa`). Desde 0,61 Landis y Koch (1977) llaman «sustancial» al acuerdo. Es una convención sin respaldo empírico, y el kappa depende de la frecuencia de cada categoría. El equipo fija el umbral antes de medir.

Reglas. `validated` es verdadero sólo si todas se cumplen y no falta nada. Cada una aparece en `rules` con su valor.

| Regla | Qué exige |
|---|---|
| `area`, `value_holder`, `needs_person` | Límite inferior del kappa contra la referencia, de 0,6 o más |
| `limit:<id>` | Lo mismo, para cada límite con al menos 5 pedidos positivos en la muestra (`--min-limit-positives`). Con menos casos la regla falla y dice cuántos hay, salvo que el límite se exima por nombre con `--waive limit:<id>`; la exención queda en la salida |
| `extraction:recall`, `extraction:precision` | Valor de 0,8 o más (`--target-rate`, la tasa que se espera de una extracción que sirve). El límite inferior se imprime |
| `extraction:unaligned_share` | Unidades sin alinear, a lo más 0,2 (`--max-unaligned-share`) |
| `people:*` | Kappa entre las dos personas, valor puntual de 0,6 o más. Es el techo de las etiquetas; con 26 unidades dobles su intervalo mide ±0,25 y mirar el límite inferior pediría un acuerdo casi perfecto |
| `retest:area`, `retest:needs_person` | Límite inferior del kappa entre las dos corridas, de 0,6 o más |
| `retest:unaligned_share` | Unidades de la repetición sin alinear, a lo más 0,2 |
| `reference:unadjudicated` | Ninguna unidad con desacuerdo sin adjudicar |

Falta algo si no hay segunda persona (`second_rater`) o no hay repetición (`retest`). Las dos corridas se emparejan por orden dentro de la unidad, sólo si encontraron el mismo número de pedidos. La extracción no es determinista: `claude -p` no fija semilla ni temperatura.

El analizador del producto. La extracción y el analizador del producto son dos llamadas distintas, y el muro de un límite lo sostiene el analizador (`guards_touched`). `row-validation.mjs analyzer` compara, por límite y por unidad, lo que el analizador tocó con lo que las personas encontraron en la misma unidad: recall, precisión y kappa. Las respuestas del analizador para las unidades etiquetadas se recogen a mano por la API del producto (una línea `{ unit, guards_touched }` por unidad). Mientras no se mida, el kappa por límite de la extracción es un indicio y no una medida del muro.

Qué cambia en el resto. `route-experiment.mjs` informa `validated` y `valid_for_acceptance`. Sus cifras sobre las filas se llaman `agreement_with_rows`, estén validadas o no. Con `--labels` enruta exactamente los pedidos de las unidades etiquetadas y agrega `agreement_with_labels` sobre esos mismos pedidos. Ese es el acierto.

Estimación asistida por predicciones. Con pocas etiquetas y muchas predicciones baratas, la inferencia asistida por predicciones (Angelopoulos et al., 2023) estrecha el intervalo. El método no la adopta en 1.0. La medición del 2026-10-27 (`bench/area-method-ppi.mjs`) usa 78 pedidos etiquetados y una tasa verdadera de 0,8. Con 90 pedidos enrutados, el semiancho es 0,095 contra 0,089 del estimador clásico: no hay ganancia. Con 360 baja a 0,063 si la extracción acierta 0,85 de las veces, y a 0,050 si acierta 0,95. Con 3.600 llega a 0,049 y 0,029. Exige enrutar toda esa cantidad sin etiqueta, con una llamada cada una, y las etiquetas deben ser una muestra uniforme; las nuestras son estratificadas. El conjunto de ajuste de un corpus del tamaño del ejemplo tiene del orden de 90 pedidos.

## 4. Conjunto de áreas

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
| 5 | Se mide el reparto (sección 9) con las descripciones |

Un área existe si cumple los cuatro criterios.

| Criterio | Umbral y perilla | Fuente del umbral |
|---|---|---|
| Volumen | al menos 26 filas (`--min-rows`) | El menor n para el que el intervalo de Wilson de una tasa de 0,8 tiene semiancho 0,15 (`--target-rate`, `--half-width`; sección 3). Con 3 de 3 aciertos ese intervalo va de 0,44 a 1; una proporción del corpus no dice cuántos pedidos hay para medir |
| Se reconoce por el texto | los límites inferiores de Wilson de su recall y de su precisión superan su proporción en el corpus | Clasificador bayesiano sobre el resumen, sin el módulo, que es parte del objeto del que sale el área. Validación cruzada de 5 pliegues (`--folds`) repetida 10 veces (`--repeats`), con 1,96 desviaciones (`--z`). Los pliegues se arman por unidad: dos pedidos de un mismo mensaje nunca quedan a ambos lados |
| Mapa propio | sus diez módulos más frecuentes comparten a lo más la mitad con los de cada otra área (`--max-overlap`) | Definición: más de la mitad en común es el mismo mapa |
| Tratamiento distinto | su límite dominante difiere del de cada otra área candidata, o alguna dimensión difiere en 0,5 desviaciones estándar o más (`--min-effect`) con un valor p ajustado de 0,05 o menos (`--alpha`) | Cohen (1988): 0,5 es el efecto mediano. El valor p sale de una prueba de permutación de 999 repeticiones (`--permutations`; Phipson y Smyth, 2010) y se ajusta con el método de Holm (1979) sobre las cinco dimensiones |

La proporción es la línea base. Un clasificador que no lee el texto obtiene esa precisión, ya sea que reparta por proporciones o elija siempre el área mayor. Obtiene ese recall si reparte por proporciones. Exigir las dos cotas evita que un área dominante apruebe sólo por absorber todo. El intervalo es el de Wilson (1927) y no el de Wald. Con 3 aciertos de 3, Wald da un límite inferior de 1 y Wilson da 0,44 (Brown, Cai y DasGupta, 2001). El criterio es un diagnóstico del corpus y no del enrutador. Dice si el texto de los pedidos separa las áreas, no si un modelo que lee una descripción las elige bien. Eso lo mide la sección 9.

Medición del 2026-10-26 (`bench/area-method-recognition.mjs`, corpus inventados con una proporción conocida de palabras sin señal). Con texto sin señal, ninguna de las áreas aprueba en 30 corpus, sea cual sea su proporción (70/20/10 y 92/5/3/2). Con señal hasta 0,7 de palabras compartidas, las cuatro áreas de 60, 40, 20 y 12 filas aprueban en los 30 corpus. La franja de transición va de 0,75 a 0,9. Dentro de ella, con una sola partición, entre 2 y 15 de 32 veredictos cambiaban sólo por la semilla de los pliegues. Con 10 repeticiones cambian entre 0 y 5. Con esa evidencia el criterio se conserva.

Una área candidata es la que alcanza el volumen mínimo. Un área que no lo alcanza se funde y no decide si otra es distinta. El límite dominante es el más tocado; si dos empatan el primer lugar, el área no tiene límite dominante y el límite no decide. Dos áreas difieren por límite sólo si las dos tienen uno y no es el mismo.

Se comparan cinco dimensiones a la vez. Con una regla fija de 0,5 desviaciones, un grupo chico parece distinto casi siempre. Es la medición del 2026-10-27 (`bench/area-method-treatment.mjs`) con 400 pares de grupos de la misma distribución por tamaño:

| Tamaños | Regla fija de 0,5 | Permutación con Holm |
|---|---|---|
| 3 y 40 | 0,92 | 0,03 |
| 5 y 40 | 0,83 | 0,06 |
| 20 y 20 | 0,47 | 0,05 |
| 20 y 40 | 0,34 | 0,06 |
| 40 y 40 | 0,12 | 0,04 |

Las dimensiones son estimaciones del modelo y están correlacionadas entre sí, y las filas de una unidad no son independientes. La prueba no supone lo primero y no modela lo segundo. Un resultado cerca del nivel se lee con esa reserva.

El informe avisa en `warnings` cuando no hay nada que repartir:

| Aviso | Cuándo |
|---|---|
| `corpus_small` | El corpus tiene menos de dos veces el mínimo de filas |
| `single_member` | El equipo tiene un solo miembro |
| `single_area` | Menos de dos áreas cumplen los criterios |
| `confirmation_short` | El conjunto de confirmación de un área tendría menos pedidos que los que pide el intervalo |

El informe incluye por área su perfil. Lleva tamaño, pedidos por semana, medias de las dimensiones y fracción que exige a una persona. Lleva también quién pide, quién tiene el valor, los límites más tocados, lo que se maximiza y se sacrifica, los módulos y las intenciones. Con las mismas filas el informe es idéntico: las particiones y las permutaciones usan una semilla fija.

Cuándo cambia el conjunto. Dos corridas seguidas significan dos cortes distintos de los datos, por fecha. Dos corridas sobre las mismas filas dan el mismo informe por construcción y no prueban nada. `analyze --cut AAAA-MM-DD` (sin fecha, la mediana de las fechas) analiza por separado las filas anteriores al corte y las posteriores, y agrega `stability` al informe.

| Regla | Qué mira `stability` | Automatizado |
|---|---|---|
| Nace un área | Un subconjunto de otra cumple los criterios en las dos ventanas (`stable_keep`) | Sólo la medición. La persona define el subconjunto en `families.json` y vuelve a correr `analyze --cut` |
| Se une a otra | Baja del volumen mínimo en las dos ventanas (`volume_fail_both`) | Sí |
| Se une a otra | El enrutador la confunde con esa otra más veces de las que la acierta (`merge_suggestions` de la sección 9) | Sí |
| Se repite la medición | Al sumar un miembro y cuando el equipo cambia lo que hace | No, la decide el equipo |

## 5. Descripción de un área

`propose` arma cada descripción con las cláusulas de la sección 1. El propósito viene de `purposes.json`; el resto sale del perfil del área.

| Cláusula | Cómo se obtiene |
|---|---|
| Se maximiza | Una sola cualidad: la frase más representativa de `maximize` de las filas no confidenciales. Las otras dos más frecuentes quedan como candidatas en `candidates.maximize` del archivo de carga, para que el equipo elija |
| Se sacrifica | Hasta tres frases representativas de `sacrifice`: la palabra más repetida elige la frase más frecuente que la contiene, y esa palabra sale de la ronda siguiente |
| Entorno | Los hechos que el equipo declara en `environment` de `purposes.json`. Sin ellos la cláusula no se escribe. Cuánto pide cada persona es un dato del informe y no del entorno |
| Límites | Hasta tres límites más tocados, cada uno con quién lo levanta o con su mecanismo, o «sin mecanismo declarado» |
| Entra | Hasta tres resúmenes, uno por módulo frecuente, de filas no confidenciales |
| No entra | Las áreas con que el reconocimiento por texto más la confunde |

La descripción tiene a lo más 1.024 caracteres (`TEMPLATE_DESCRIPTION_MAX`). Si no cabe, se quitan primero los ejemplos, luego el borde y luego el entorno. Las cláusulas con propósito, qué se maximiza, qué se sacrifica y límites no se quitan: si ellas solas no caben, `propose` se detiene.

Una descripción más larga no es mejor por serlo. La medición del 2026-10-21 (`docs/investigaciones/mediciones/2026-10-21-descripciones-de-area-largas.md`) lo muestra. Las descripciones largas bajaron la exactitud de área de 82,6 % a 75,8 %, por dos frases y no por el largo. La corrección de una descripción nombra el borde con el vecino sólo cuando la medición muestra una confusión de dos casos o más (`--min-border-confusions`).

`propose` deja cada área sin confirmar (`confirmed: false`). La cualidad que se maximiza y lo que se sacrifica salen de lo que la gente pidió, no de lo que el equipo decidió. El equipo lee las cláusulas de cada área, elige o reemplaza la cualidad entre los candidatos y marca `confirmed: true` con su correo en `confirmed_by`. El cargador rechaza un área sin confirmar (sección 12).

## 6. Plantillas por área

Una plantilla por intención con 20 pedidos o más dentro del área, sin contar los de unidades confidenciales (`--min-template`). Con 20 pedidos, el error estándar de la media de una dimensión es 0,22 desviaciones (1 / √20). Las intenciones con menos pedidos se atienden con la plantilla más cercana del área. `--intents` agrupa etiquetas de intención en un solo nombre de plantilla.

Campos comunes, porque deciden el reparto y no se deducen del área:

| Campo | Contenido |
|---|---|
| `request` | qué se pide |
| `value_missing` | qué falta y de quién es el valor; texto libre, nadie si nada falta |
| `limits_touched` | límites que toca y quién los levanta |
| `undo` | cómo se deshace y cuánto cuesta (opcional) |

Los campos propios de una intención salen de lo que los pedidos de ese subconjunto traían o les faltaba, y se entregan en `--intent-fields` (`{ "Falla": [{ "name": "steps", "label": "Pasos para reproducir", "required": true }] }`). El bloque `output` lleva un campo booleano `touches_<id>` por cada límite del área: es lo único booleano. La sección «Salida» del cuerpo repite qué se maximiza, qué se acepta perder y dónde se detiene la sesión.

## 7. Perfil de un miembro

`propose` redacta un borrador en primera persona con lo que el corpus dice del miembro; la persona lo corrige.

| Parte | Origen |
|---|---|
| Qué hace | La oración `role` de `team.json`, escrita por el propio miembro o por el equipo |
| Qué maximiza y qué acepta perder | Frases de los pedidos que hizo (persona) o que recibió (agente) |
| Dónde pide, o cómo se reparte lo que atiende | Áreas con su porcentaje |
| Qué decide | Pedidos donde él tiene el valor que falta, por área, y los límites de persona que más levanta |
| Qué no decide (agente) | Los límites que levanta una persona |
| Cómo quiere recibirlo | Grado de guía, extensión y lo que no quiere recibir. Lo escribe la persona al corregir el borrador; `propose` no lo infiere del corpus |

Las reuniones confidenciales aportan sólo conteos y ninguna frase suya entra a un perfil. Un perfil nombra sólo las áreas del archivo de carga. El borrador no contiene señales de tono ni de guía: esas dos cosas las escribe la persona en «Cómo quiere recibirlo». El reparto lo decide el valor que falta en cada pedido, porque quién pide explica poco de cómo se atiende. Un perfil no supera `config.members.profileMaxLength`, 4.000 caracteres (UD-023). Si no cabe, `propose` quita primero las frases de lo que maximiza y de las áreas. Se detiene si el rol solo no cabe.

## 8. Descripción del proyecto

Texto de la descripción del proyecto, con las mismas cláusulas.

| Cláusula | Pregunta |
|---|---|
| Propósito | Por qué existe el proyecto. Desempata cuando dos opciones sirven igual al propósito |
| Se maximiza | Una sola cualidad que gana cuando hay que renunciar a algo |
| Se sacrifica | Qué no persigue |
| Entorno | Hechos que no cambian: quién construye, qué está en producción, qué tope de gasto rige |
| Límites | Lo que nunca se cruza, con su mecanismo |

Criterio de aceptación. Es un procedimiento manual: ningún guion lo ejecuta.

| Paso | Qué se hace |
|---|---|
| 1 | Se toman 26 pedidos de las filas, la misma cuenta de la sección 3, con límites tocados y sin ellos |
| 2 | Un modelo que lee sólo la descripción del proyecto y el pedido nombra el límite en juego |
| 3 | Se cuenta cuántas veces coincide con `limits` de la fila y se informa con su intervalo de Wilson |
| 4 | El equipo fija la proporción que acepta antes de medir |

## 9. Medir el reparto

```
node scripts/route-experiment.mjs rows.jsonl --holdout --purposes purposes.json --team team.json --stage tune --judge --out result.json
node scripts/route-experiment.mjs rows.jsonl --holdout --purposes purposes.json --team team.json --stage tune --labels labels.jsonl --reference-rater ana --units units.jsonl --raw --validation validation.json --out result.json
```

Un enrutador liviano lee sólo las descripciones de las áreas y los perfiles, y cada pedido de la muestra. Devuelve área, quién atiende y un encargo de una línea. El resultado se compara con la fila sin juez.

Lo que se construye y lo que se mide son filas distintas. `--holdout` reparte las unidades (nunca las filas) en tres conjuntos: construcción, ajuste y confirmación. Se retiene el 50 % de las unidades (`--holdout 0.5`) y se parte en dos mitades iguales. Resulta la partición 50 / 25 / 25 que Hastie, Tibshirani y Friedman (2009, sección 7.2) sugieren para datos abundantes. El experimento llama a `propose` con el conjunto de construcción y mide sobre el retenido que se pidió con `--stage`. Los ejemplos de una descripción y los perfiles salen sólo del conjunto de construcción. El resultado informa cuántas filas medidas son un ejemplo citado (`leaked_examples`, debe ser 0). Sin `--holdout`, `--load` mide con las mismas filas con que se escribió y el guion avisa que el resultado no vale como medida.

| Medida | Definición |
|---|---|
| `agreement_with_rows.area` | El área elegida es la de la fila. Lleva su intervalo de Wilson |
| `agreement_with_rows.person` | Se incluye a una persona cuando la fila exige a una persona, y a ninguna cuando no. Si el valor es de una persona con nombre, esa persona debe estar entre las incluidas; otras de más no cuentan en contra. Si lo exige un límite y el valor es del modelo, sirve cualquier persona |
| `person_extra`, `person_missing` | Se agregó una persona que no hacía falta, o no se incluyó ninguna cuando hacía falta |
| `baselines` | Lo que obtienen enrutadores sin modelo sobre los mismos pedidos: siempre el área mayor de la construcción, siempre el agente solo y siempre quien pide |
| `agreement_with_labels` | Con `--labels`, el acuerdo con las personas. Se calcula sobre exactamente los pedidos de las unidades que ellas etiquetaron y que la extracción escribió con el mismo número de pedidos, los mismos que usa `agreement_with_rows`. Trae sus propias líneas base y, con `--raw`, `raw`: la misma medida con el texto original de las unidades de un solo pedido en vez del resumen |
| `validated`, `valid_for_acceptance` | Si el informe de validación de la sección 3 pasó (`--validation`). `valid_for_acceptance` exige además etiquetas de personas |
| `confusions` | Pares de áreas que el enrutador confunde, con su conteo |
| `indicators` | Con `--judge`, el promedio de cada uno de cuatro indicadores (1.1, 1.2, 2.3, 3.3) de −2 a +2 |

Una tasa se lee junto a su línea base. En el ejemplo inventado, 69 % de los pedidos no exige a una persona. Un enrutador que elige siempre al agente solo acierta la persona en esa proporción, así que 0,8 aporta poco sobre 0,69. 

Sin `--labels`, la muestra se estratifica por área. Cada área aporta 26 pedidos o todos los que tiene. Es la cuenta de la sección 3, que da un intervalo de Wilson de semiancho 0,15. Si `--sample` pide menos que 26 por área, el total sube y el resultado lo avisa. Lo que falta para llegar a `--sample` se sortea del resto. El sorteo es un barajado Fisher-Yates con semilla (Durstenfeld, 1964). Cada pedido pesa lo que pesa su área en el corpus. Las tasas globales usan esos pesos y su intervalo usa el tamaño efectivo de Kish (1965). Las filas de un área que se funde se miden contra el área en que se funde. Los pedidos de unidades confidenciales no se enrutan. Con `--labels` no hay sorteo. Se enrutan los pedidos etiquetados de la etapa y cada uno pesa lo que pesa el estrato de su unidad. Los avisos cubren las áreas con pocos pedidos y las unidades sin alinear.

El resultado informa cuántos pedidos se pidieron, se sortearon y se descartaron. También trae avisos: un área con menos pedidos que los del intervalo, o un corpus menor que la muestra. `by_area` da la tasa de cada área con su intervalo, que es donde se ve una área chica. `merge_suggestions` lista los pares en que el enrutador confunde un área con otra más veces de las que la acierta.

Comparar dos versiones. `--versus otro-resultado.json` empareja los pedidos que las dos corridas enrutaron y aplica la prueba exacta de McNemar (1947) a los casos en que sólo una acierta. Como los pedidos son los mismos, la diferencia tiene menos error (Miller, 2024, arXiv:2411.00640, consultado el 2026-10-27). Una diferencia de un caso da p igual a 1.

`--judge` usa por omisión el mismo modelo que enruta. Un modelo favorece lo que genera (sección 3), así que el resultado trae `judge.same_model` y, mientras sea verdadero, los indicadores se leen con esa reserva. `--judge-model` fija otro modelo. Los indicadores de un reparto miden la coherencia del reparto con el acuerdo. Son los indicadores 1.1, 1.2, 2.3 y 3.3 de la sección 11, aplicados a un reparto.

`--accept <proporción>` compara el límite inferior del intervalo de Wilson de área y de persona. Pide además que el límite inferior supere al mejor enrutador sin modelo de `baselines`. Un valor puntual que apenas toca el umbral pasa la mitad de las veces cuando la tasa verdadera es el umbral. Sin `--labels` la única referencia es la extracción. El comando sale con código 2, o con `--allow-unvalidated` compara contra las filas y marca el resultado como no válido. Sin `--accept` sólo se informan los números, porque el umbral es del equipo. La cuota que gasta una corrida se lee en el informe de uso del proveedor.

Se corrige la descripción donde hay una confusión de dos casos o más. La corrección se prueba contra el conjunto de ajuste (`--stage tune`) y se repite hasta que una versión nueva ya no mejora el área ni la persona. Las descripciones se ajustan con una muestra y se confirman con otra. El conjunto de confirmación (`--stage confirm`) se lee una vez, al final, y no sirve para seguir corrigiendo.

## 10. Prueba con un miembro nuevo

Los procedimientos se replican con alguien de quien sólo hay una reunión de incorporación y sus mensajes.

| Paso | Qué se hace | Criterio | Automatizado |
|---|---|---|---|
| 1 | Agregar sus unidades y extraer sus filas | Cada pedido con sus dimensiones | Sí, `request-rows.mjs` |
| 2 | Correr `analyze`: sus pedidos caen en las áreas existentes o piden una nueva con los cuatro criterios | Si cumple los cuatro nace el área; si no, su trabajo entra al área más cercana | Sí, `analyze` |
| 3 | Redactar su perfil con `propose` y corregirlo con la persona | Ninguna palabra de la reunión en el perfil | Sí el borrador; la corrección es manual |
| 4 | Correr el experimento con 26 pedidos donde el valor es suyo y 26 donde no | Lo incluye cuando el valor es suyo y no lo incluye en los otros; el umbral lo fija el equipo | Manual: se eligen los pedidos y se corre `route-experiment.mjs` sobre ellos |
| 5 | Comparar su perfil completo con uno de una línea en la misma corrida | El completo no puntúa menos en los indicadores. Se compara con `--versus` | Manual: se arma el archivo de carga con la línea y se corre dos veces |
| 6 | Pedir a la persona que marque lo que no la describe | Una corrección por cláusula como máximo | Manual |

## 11. Evaluación del trabajo

Al terminar un trabajo, el proveedor de texto lo juzga con una rúbrica de doce indicadores en cuatro ejes (`src/execute/judge.js`). Responde qué tan adecuado fue lo que se hizo, que las estimaciones del analizador sólo anticipan. Los ejes 1 y 2 miden lo que quedó hecho. Los ejes 3 y 4 miden lo que la persona queda en condición de entender y decidir. Un eje alto no compensa uno bajo, y por eso no hay puntaje único.

| Eje | Indicadores |
|---|---|
| 1. Alineación estratégica | 1.1 claridad estratégica, 1.2 especificación del problema, 1.3 propósito central |
| 2. Integridad del artefacto | 2.1 fiabilidad funcional, 2.2 integridad bajo presión, 2.3 precisión y conformidad (incluye los límites del área) |
| 3. Eficiencia del proceso | 3.1 utilización de recursos, 3.2 comprensibilidad del resultado, 3.3 calidad del esfuerzo cognitivo |
| 4. Colaboración y transparencia | 4.1 transparencia del razonamiento, 4.2 intervención crítica, 4.3 resultado sobre la primera propuesta |

Cómo se lee:

| Regla | Detalle |
|---|---|
| Escala | −2 inaceptable, −1 bajo, 0 esperado, +1 fuerte, +2 excepcional. El 0 es el mínimo aceptable y no un punto medio |
| Anclas | Cada indicador trae cinco anclas, una por nivel (`KPIS[].levels`), escritas para un trabajo sin supervisión. Van en el prompt del juez |
| Evidencia | El juez recibe el mensaje, lo esperado, los límites tocados, el resultado, la salida técnica, la descripción del área y la del proyecto. Cada puntaje lleva una cita de esa evidencia, una afirmación y su razonamiento |
| Validación | Cada indicador aparece una vez y cada cita está en la evidencia entregada. Una respuesta que no valida no se guarda como juicio y queda en la auditoría como `job.judge_rejected` |
| Lo que no aplica | Un indicador que no se puede observar en un trabajo sin supervisión lleva `applies: false` y queda fuera de su eje; nunca se rellena con 0 |
| Meta del eje | La da el cuadrante de la tarea: un eje cumple cuando su media alcanza la meta de ese cuadrante |
| Sin total | No hay puntaje único por trabajo. Se compara eje por eje y entre trabajos del mismo cuadrante |

Tres indicadores se adaptan a un trabajo que nadie supervisó, y su redacción lo dice. El 3.2 juzga lo que se le entrega a la persona y cuánto se entiende, porque su experiencia durante la sesión no existe. El 4.2 puntúa sólo las intervenciones que la respuesta final y la salida técnica dejan ver. El 4.3 necesita la primera propuesta como evidencia y la plataforma todavía no la entrega, así que queda sin puntuar. En un trabajo sin supervisión el eje 4 se apoya en el 4.1 y el 4.2. Un eje sin indicadores observables no cumple ni incumple su meta.

El cuadrante clasifica la tarea para fijar la meta de cada eje (McGrath, 1984, *Groups: Interaction and Performance*). Las metas son la media mínima: 0 esperado, 1 fuerte, 2 excepcional.

| Cuadrante | La tarea | Eje 1 | Eje 2 | Eje 3 | Eje 4 |
|---|---|---|---|---|---|
| Generar | Planificar y crear | 2 | 0 | 1 | 1 |
| Elegir | Decidir entre opciones | 1 | 0 | 0 | 2 |
| Negociar | Resolver un conflicto de puntos de vista o de intereses | 1 | 1 | 0 | 2 |
| Ejecutar | Cumplir un plan con un resultado medible | 0 | 2 | 1 | 0 |

Usos al configurar. Ninguno tiene guion: son lecturas manuales de los juicios guardados (`GET /api/messages/:id/timing` trae el juicio de un mensaje).

| Pregunta | Dónde se lee |
|---|---|
| ¿El modelo liviano alcanza en esta área? | Los ejes de los trabajos juzgados por área y por modelo. Un eje bajo la meta en el modelo liviano y sobre ella en el mayor mueve el área al mayor |
| ¿Una descripción de área genera trabajo adecuado? | Los indicadores 1.1 y 1.2 de los trabajos del área antes y después de cambiar la descripción. El juez ve la descripción del área, así que también puede notar que no se respeta |
| ¿Un límite se respeta? | El indicador 2.3 y el campo `touches_<id>` de la salida. Ningún código los cruza: los lee una persona |

Escalada. La escalada al modelo mayor ocurre por falla comprobada. El modelo liviano declara que no pudo cerrar, termina bloqueado, o la verificación de la entrega queda en rojo (`src/execute/handler.js`, `src/execute/deliver.js`). Una falla silenciosa sólo la ve el control de cierre del anfitrión. Todo intento se juzga, también el del modelo liviano que falló (con la nota `no_cerro`), así que la comparación entre modelos cuenta los fallos del liviano.

Los límites del modelo liviano (`EXECUTE_LIGHT_LIMITS`) nacen sin valor: `create=1 irreversibility=1 certainty=0`. Por eso todo mensaje con estimaciones parte en el modelo liviano. Se fijan con el punto medio entre la mayor estimación de lo que cerró y la menor de lo que no cerró. Eso exige que los rangos no se crucen en al menos 20 trabajos juzgados (`docs/investigaciones/mediciones/2026-10-25-los-limites-del-modelo-ligero.md`).

Ruido. La media de un indicador sobre 20 trabajos tiene un error estándar de 0,22 desviaciones. Con una desviación de un punto, dos medias de 20 trabajos difieren con error de 0,32 y margen de 0,62 al 95 %. Una diferencia menor no es una señal.

## 12. Archivo de carga

`propose` escribe el archivo de carga y `scripts/apply-load-file.mjs` lo aplica con las funciones del dominio (`createArea`, `updateArea`, `createTemplate`, `updateTemplate`, `updateMember`).

```json
{
  "version": 2,
  "actor": "ana@ejemplo.org",
  "areas": [{
    "title": "Catálogo y precios", "description": "…", "position": 2,
    "confirmed": false, "candidates": { "maximize": ["precio exacto en cada ficha", "stock real publicado"], "sacrifice": ["orden de las fotos"] },
    "guards": [{ "text": "mover dinero o fijar un precio", "mechanism": "", "person": true }, { "text": "datos personales de clientes", "mechanism": "la credencial del asistente no lee la tabla de clientes", "person": false }],
    "templates": [{ "name": "Ajuste", "description": "…", "body_markdown": "---\nname: …\n---\n…" }]
  }],
  "members": [{ "email": "ana@ejemplo.org", "profile": "…" }]
}
```

| Campo | Regla |
|---|---|
| `actor` | Correo del miembro que registra la auditoría; es opcional en la propuesta y obligatorio al cargar |
| `areas[].confirmed` | Booleano obligatorio. `propose` lo escribe falso; el equipo lo marca verdadero al confirmar la cualidad y el sacrificio. El cargador rechaza un área con falso |
| `areas[].guards[]` | `{ text, mechanism, person }`. Son todos los límites del equipo, en cada área: un límite es del equipo y no del área, y el analizador sólo lo detecta donde está instalado. La descripción nombra los más tocados. `mechanism` es texto, vacío si no hay |
| `areas[].templates[]` | `body_markdown` es una plantilla válida (`src/analyze/templates.js`); `name` y `description` salen de su encabezado |
| `members[]` | Un miembro existente, por correo |
| `validateLoadFile` | Rechaza una plantilla que no se lee, un área o una plantilla repetidas, un miembro sin correo, un área sin `confirmed` booleano, un límite sin texto, sin `person` booleano o sin `mechanism`, y una versión distinta de la 2 |

```
node scripts/apply-load-file.mjs load.json --db /data/team.db [--only-confirmed] [--require-mechanism]
```

El cargador es idempotente. Encuentra un área por su título, una plantilla por su nombre dentro del área, un límite por su texto y un miembro por su correo. Lo que ya tiene el contenido del archivo no se escribe de nuevo y no deja línea en la auditoría. Aplicarlo dos veces deja el mismo estado. Agrega y actualiza, y nunca borra un área, una plantilla ni un límite que el archivo no nombra. Todo ocurre en una transacción.

Antes de escribir rechaza un archivo inválido, un `actor` que no sea una persona activa, un miembro que no existe y un área sin confirmar. `--only-confirmed` aplica las confirmadas y omite las demás. Un límite que no es de persona y no declara mecanismo se aplica y se informa. El producto lo acepta y la descripción ya dice «sin mecanismo declarado». `--require-mechanism` lo rechaza. Cada área creada o actualizada deja `area.method_load` en la auditoría, con quién la confirmó.

Una prueba aplica el archivo dos veces sobre una base real y compara el estado y la auditoría.

## 13. Perillas

| Perilla | Omisión | Fuente |
|---|---|---|
| `--min-rows` | 26 | Cuenta del intervalo de Wilson con `--target-rate` 0,8 y `--half-width` 0,15 |
| `--target-rate` | 0,8 | La tasa que se espera de un reparto que funciona; con 0,8 observado y 26 pedidos el límite inferior es 0,62, sobre el azar |
| `--half-width` | 0,15 | Semiancho buscado del intervalo de cualquier tasa; es del equipo |
| `--min-effect` | 0,5 | Cohen (1988), efecto mediano |
| `--max-overlap` | 0,5 | Definición de mapa compartido |
| `--alpha` | 0,05 | Nivel convencional (Fisher, 1925), repartido entre las dimensiones con Holm |
| `--permutations` | 999 | El menor valor p posible es 0,001, bajo 0,05 dividido en las 5 dimensiones (Phipson y Smyth, 2010) |
| `--min-template` | 20 | Error estándar de 0,22 desviaciones |
| `--z` | 1,96 | Percentil 97,5 de la normal |
| `--folds` | 5 | Validación cruzada de 5 pliegues |
| `--repeats` | 10 | Medición del 2026-10-26: con 1 partición, 2 a 15 de 32 veredictos cambiaban sólo con la semilla; con 10, 0 a 5 |
| `--map-size` | 10 | Los diez módulos más frecuentes definen el mapa; una lista más larga llega a módulos que aparecen una vez |
| `--seed` | 7 | Semilla fija para repetir el informe |
| `--max-confidential-share` | 0,5 | Definición: un área está sustentada por filas confidenciales cuando son más de la mitad de las suyas |
| `--sample` (experimento) | 26 por área | La misma cuenta; `--sample` fija el total y no baja de 26 por área |
| `--min-border-confusions` | 2 | Una confusión aislada puede venir de una fila mal extraída; dos casos ya son un patrón. Es del equipo |
| `--holdout` (experimento) | 0,5 | Partición 50 / 25 / 25 de Hastie, Tibshirani y Friedman (2009), sección 7.2 |
| `--min-kappa` (validación) | 0,6 | Desde 0,61 el acuerdo es «sustancial» (Landis y Koch, 1977); es una convención y es del equipo. Se aplica al límite inferior |
| `--max-unaligned-share` (validación) | 0,2 | Perilla del equipo: con más de una unidad de cada cinco sin alinear, el kappa describe sólo la parte del corpus donde las dos lecturas ya coincidían en cuántos pedidos hay |
| `--min-limit-positives` (validación) | 5 | Cortesía declarada: el kappa de una categoría con menos de 5 casos cambia con una sola etiqueta |
| `--resamples` (validación) | 1000 | Al menos 1.000 remuestreos para intervalos por percentiles (Efron y Tibshirani, 1993) |
| Tope de límites y de frases | 3 | Una descripción cabe en 1.024 caracteres (`TEMPLATE_DESCRIPTION_MAX`); no tiene opción |

## Fuentes

Las citas con fecha de consulta se leyeron ese día. Las demás son obras publicadas.

| Fuente | Se usa en |
|---|---|
| Wilson (1927), *Probable inference, the law of succession, and statistical inference*, J. Am. Stat. Assoc. 22:209-212 | Intervalos de proporciones |
| Brown, Cai y DasGupta (2001), *Interval estimation for a binomial proportion*, Statistical Science 16:101-133 | Wilson en vez de Wald |
| Cohen (1960), *A coefficient of agreement for nominal scales*, Educ. Psychol. Meas. 20:37-46 | Kappa |
| Cohen (1988), *Statistical Power Analysis for the Behavioral Sciences* | Efecto mediano de 0,5 |
| Landis y Koch (1977), *The measurement of observer agreement for categorical data*, Biometrics 33:159-174 | Umbral de kappa |
| Efron y Tibshirani (1993), *An Introduction to the Bootstrap* | Remuestreos |
| Holm (1979), *A simple sequentially rejective multiple test procedure*, Scand. J. Statistics 6:65-70 | Ajuste por comparaciones múltiples |
| Phipson y Smyth (2010), *Permutation p-values should never be zero*, Stat. Appl. Genet. Mol. Biol. 9:39 | Valor p de permutación |
| Fisher (1925), *Statistical Methods for Research Workers* | Nivel 0,05 |
| Durstenfeld (1964), *Algorithm 235: Random permutation*, Commun. ACM 7:420 | Barajado |
| Kish (1965), *Survey Sampling* | Tamaño efectivo con pesos |
| McNemar (1947), *Note on the sampling error of the difference between correlated proportions*, Psychometrika 12:153-157 | Comparación pareada |
| Hastie, Tibshirani y Friedman (2009), *The Elements of Statistical Learning*, 2.ª ed., sección 7.2 | Partición de datos |
| McGrath (1984), *Groups: Interaction and Performance* | Cuadrantes de la tarea |
| Anderson y Krathwohl (2001), *A Taxonomy for Learning, Teaching, and Assessing* | `understand_vs_create` |
| Pangakis, Wolken y Fasching (2023), arXiv:2306.00176, consultado el 2026-10-27 | Validar anotaciones con personas |
| Panickssery, Bowman y Feng (2024), arXiv:2404.13076, consultado el 2026-10-27 | Preferencia de un modelo por lo que genera |
| Miller (2024), arXiv:2411.00640, consultado el 2026-10-27 | Error de una diferencia pareada |
| Liu et al. (2023), arXiv:2307.03172, consultado el 2026-10-27 | Información en medio de un contexto largo |
| Truong, Baldwin, Verspoor y Cohn (2023), arXiv:2306.08189, consultado el 2026-10-27 | Negación en modelos de lenguaje |

