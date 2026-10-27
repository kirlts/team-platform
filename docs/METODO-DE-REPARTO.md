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

Sólo el límite es booleano. El producto lo guarda como `guards` del área (texto, mecanismo y si lo levanta una persona) y el analizador devuelve cuáles toca cada mensaje (`guards_touched`). Todo lo demás son estimaciones continuas con su razón (`src/domain/assessment.js`). `understand_vs_create` e `irreversibility` van de 0 a 1. `value_holder` es `person` o `model` y dice de quién es el valor que falta.

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

`request-rows.mjs` pide a un modelo liviano, por lotes de unos 18.000 caracteres, una fila por pedido con salida validada por esquema. Cada lote queda en la carpeta de `--cache` y un corte no repite lo hecho. El archivo se nombra con un hash del contenido del lote, las instrucciones, el esquema, el proveedor y el modelo. Otro texto, otro proveedor u otro modelo nunca encuentra el archivo de una corrida anterior. Cada fila guarda el modelo y la versión del guion (`model`, `script_version`).

La extracción no es determinista: `claude -p` no fija semilla ni temperatura, y dos corridas dan filas distintas. Por eso la sección 3 pide repetirla sobre la muestra validada y medir el acuerdo entre corridas. Un correo o una cifra larga en los textos de una fila se reemplaza y se cuenta. Una fecha ISO se deja.

| Campo | Contenido |
|---|---|
| `unit`, `date`, `source`, `confidential` | origen del pedido |
| `who`, `to` | miembro que pide y miembro a quien va, o `other` |
| `summary` | una línea abstracta, sin datos personales |
| `intent`, `object`, `module` | lo que se quiere lograr, parte del sistema o del negocio, parte concreta; texto libre, una a tres palabras |
| `understand_vs_create` | 0 comprender o aplicar lo conocido, 1 crear (Anderson y Krathwohl, 2001, usada como escala) |
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

Una fila es la estimación de un modelo. Mientras ninguna persona la haya leído, lo que se mide con ella es el acuerdo con esa estimación y no el acierto. La anotación con un modelo generativo se valida contra personas (Pangakis, Wolken y Fasching, 2023, arXiv:2306.00176, consultado el 2026-10-27). Además, el extractor, el enrutador y el juez usan por omisión el mismo modelo y leen el mismo resumen. Un error común a los tres cuenta como acierto. Un modelo también favorece lo que genera (Panickssery, Bowman y Feng, 2024, arXiv:2404.13076, consultado el 2026-10-27).

```
node scripts/row-validation.mjs sample rows.jsonl --team team.json --out sample.jsonl
node scripts/row-validation.mjs agree rows.jsonl --labels labels.jsonl --team team.json --retest rows2.jsonl --out validation.json
```

| Paso | Qué se hace | Automatizado |
|---|---|---|
| 1 | `sample` arma una muestra estratificada por área y por si el pedido exige a una persona. Entrega el resumen que identifica cada pedido y ninguna estimación del extractor | Sí |
| 2 | Una persona etiqueta cada pedido sin ver la extracción: `area`, `value_holder` y `limits`, en `labels.jsonl` con su `rater` | No, la hace una persona |
| 3 | Una segunda persona etiqueta los pedidos marcados `double` | No, la hace una persona |
| 4 | Se repite la extracción sobre las mismas unidades (`rows2.jsonl`) | Sí, con `request-rows.mjs` |
| 5 | `agree` calcula el kappa de Cohen entre la extracción y la primera persona, entre las dos personas y entre las dos corridas | Sí |

Tamaños. Salen de una cuenta: el menor n para el que el intervalo de Wilson de una tasa de 0,8 tiene semiancho 0,15 (`--target-rate`, `--half-width`). Resultan 26 pedidos por área, repartidos entre los dos grupos, y 26 pedidos etiquetados dos veces. Con 21 aciertos de 26 el límite inferior es 0,62, sobre el azar. Si el área tiene menos filas abiertas que ese n, el guion avisa y toma todas. La muestra no incluye filas confidenciales: una persona las lee completas antes de `propose`.

Acuerdo. El kappa de Cohen (1960) corrige el acuerdo por el azar. Se calcula por campo: área, titular del valor, si exige a una persona (derivado con la definición de la sección 2) y cada límite. Como la muestra está estratificada, cada pedido pesa lo que pesa su estrato en el corpus. El intervalo sale de 1.000 remuestreos dentro de cada estrato (Efron y Tibshirani, 1993). El acuerdo entre las dos personas es el techo. Una confusión que también separa a las personas es una ambigüedad del criterio de área y no un error del modelo.

Repetición. La extracción no es determinista: `claude -p` no fija semilla ni temperatura. Las filas de dos corridas se emparejan por orden dentro de la unidad, sólo si ambas encontraron el mismo número de pedidos. Las demás unidades se informan como no alineadas. El kappa se calcula con los pedidos alineados.

Umbral. Las filas están validadas cuando cuatro kappa llegan a 0,6 (`--min-kappa`). Son los de área, titular del valor y «exige a una persona» contra la persona, y el de la repetición. Desde 0,61 Landis y Koch (1977) llaman «sustancial» al acuerdo; es una convención y no un estándar. El equipo fija el umbral antes de medir. Sin segunda persona o sin repetición, `validated` es falso y el informe dice qué falta.

Qué cambia en el resto. `route-experiment.mjs` informa `validated` en su resultado. Mientras sea falso, sus cifras se llaman `agreement_with_rows`. Con `--labels` agrega `agreement_with_labels`, el acuerdo del enrutador con las personas sobre los pedidos que ellas etiquetaron.

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

Se comparan cinco dimensiones a la vez. Con una regla fija de 0,5 desviaciones, un grupo chico parece distinto casi siempre. Es la medición del 2026-10-26 (`bench/area-method-treatment.mjs`) con 400 pares de grupos de la misma distribución por tamaño:

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

El informe incluye por área su perfil. Lleva tamaño, pedidos por semana, medias de las dimensiones y fracción que exige a una persona. Lleva también quién pide, quién tiene el valor, los límites más tocados, lo que se maximiza y se sacrifica, los módulos y las intenciones. Con las mismas filas el informe es idéntico: las particiones usan una semilla fija.

Cuándo cambia el conjunto. Nace un área cuando un subconjunto de otra cumple los cuatro criterios por separado en dos corridas seguidas, para que una sola corrida no decida. Se une a otra si baja del umbral de volumen en dos corridas seguidas. También se une si el enrutador la confunde con esa otra en más casos de los que acierta. Se repite la medición al sumar un miembro y cuando el equipo cambia lo que hace.

## 5. Descripción de un área

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

## 6. Plantillas por área

Una plantilla por intención con 20 pedidos o más dentro del área (`--min-template`). Con 20 pedidos, el error estándar de la media de una dimensión es 0,22 desviaciones (1 / √20). Las intenciones con menos pedidos se atienden con la plantilla más cercana del área. `--intents` agrupa etiquetas de intención en un solo nombre de plantilla.

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

Las reuniones confidenciales aportan sólo conteos y ninguna frase suya entra a un perfil. Un perfil nombra sólo las áreas del archivo de carga. El perfil de una persona calibra el tono y el grado de guía. El reparto lo decide el valor que falta en cada pedido, porque quién pide explica poco de cómo se atiende. Un perfil no supera `config.members.profileMaxLength` (4.000 caracteres).

## 8. Descripción del proyecto

Texto de la descripción del proyecto, con las mismas cláusulas.

| Cláusula | Pregunta |
|---|---|
| Propósito | Por qué existe el proyecto |
| Se maximiza | Qué gana entre dos diseños que cumplen todo |
| Se sacrifica | Qué no persigue |
| Entorno | Hechos que no cambian: quién construye, qué está en producción, qué tope de gasto rige |
| Límites | Lo que nunca se cruza, con su mecanismo |

Criterio de aceptación: un modelo que lee sólo esta descripción y un pedido de las filas nombra el límite en juego. Se cuenta cuántas veces coincide con `limits` de la fila en una muestra de 20 pedidos; el equipo fija la proporción antes de medir.

## 9. Medir el reparto

```
node scripts/route-experiment.mjs rows.jsonl --holdout --purposes purposes.json --team team.json --stage tune --sample 60 --judge --out result.json
```

Un enrutador liviano lee sólo las descripciones de las áreas y los perfiles, y cada pedido de la muestra. Devuelve área, quién atiende y un encargo de una línea. El resultado se compara con la fila sin juez.

Lo que se construye y lo que se mide son filas distintas. `--holdout` reparte las unidades (nunca las filas) en tres conjuntos: construcción, ajuste y confirmación. Se retiene el 50 % de las unidades (`--holdout 0.5`) y se parte en dos mitades iguales. Resulta la partición 50 / 25 / 25 que Hastie, Tibshirani y Friedman (2009, sección 7.2) sugieren para datos abundantes. El experimento llama a `propose` con el conjunto de construcción y mide sobre el retenido que se pidió con `--stage`. Los ejemplos de una descripción y los perfiles salen sólo del conjunto de construcción. El resultado informa cuántas filas medidas son un ejemplo citado (`leaked_examples`, debe ser 0). Sin `--holdout`, `--load` mide con las mismas filas con que se escribió y el guion avisa que el resultado no vale como medida.

| Medida | Definición |
|---|---|
| `agreement_with_rows.area` | El área elegida es la de la fila. Lleva su intervalo de Wilson |
| `agreement_with_rows.person` | Se incluye a una persona cuando la fila exige a una persona, y a ninguna cuando no. Si el valor es de una persona con nombre, esa persona debe estar entre las incluidas; otras de más no cuentan en contra. Si lo exige un límite y el valor es del modelo, sirve cualquier persona |
| `person_extra`, `person_missing` | Se agregó una persona que no hacía falta, o no se incluyó ninguna cuando hacía falta |
| `baselines` | Lo que obtienen enrutadores sin modelo sobre los mismos pedidos: siempre el área mayor de la construcción, siempre el agente solo y siempre quien pide |
| `agreement_with_labels` | Con `--labels`, el acuerdo con las personas sobre los pedidos que etiquetaron |
| `validated` | Si el informe de validación de la sección 3 pasó (`--validation`) |
| `confusions` | Pares de áreas que el enrutador confunde, con su conteo |
| `indicators` | Con `--judge`, el promedio de cada uno de cuatro indicadores (1.1, 1.2, 2.3, 3.3) de −2 a +2 |

Una tasa se lee junto a su línea base. En el ejemplo inventado, 69 % de los pedidos no exige a una persona. Un enrutador que elige siempre al agente solo acierta la persona en esa proporción, así que 0,8 aporta poco sobre 0,69. Con `--accept` el comando compara contra `agreement_with_labels` si existe y contra las filas si no.

La muestra se estratifica por área. Cada área aporta 26 pedidos o todos los que tiene. Es la cuenta de la sección 3, que da un intervalo de Wilson de semiancho 0,15. Si `--sample` pide menos que 26 por área, el total sube y el resultado lo avisa. Lo que falta para llegar a `--sample` se sortea del resto. El sorteo es un barajado Fisher-Yates con semilla (Durstenfeld, 1964). Cada pedido pesa lo que pesa su área en el corpus. Las tasas globales usan esos pesos y su intervalo usa el tamaño efectivo de Kish (1965). Las filas de un área que se funde se miden contra el área en que se funde.

El resultado informa cuántos pedidos se pidieron, se sortearon y se descartaron. También trae avisos: un área con menos pedidos que los del intervalo, o un corpus menor que la muestra. `by_area` da la tasa de cada área con su intervalo, que es donde se ve una área chica. `merge_suggestions` lista los pares en que el enrutador confunde un área con otra más veces de las que la acierta.

`--accept <proporción>` hace fallar el comando si el área o la persona quedan por debajo. Sin él sólo se informan los números, porque el umbral es del equipo. La cuota que gasta una corrida se lee en el informe de uso del proveedor.

Se corrige la descripción donde hay una confusión de dos casos o más. La corrección se prueba contra el conjunto de ajuste (`--stage tune`) y se repite hasta que una versión nueva ya no mejora el área ni la persona. Las descripciones se ajustan con una muestra y se confirman con otra. El conjunto de confirmación (`--stage confirm`) se lee una vez, al final, y no sirve para seguir corrigiendo.

## 10. Prueba con un miembro nuevo

Los procedimientos se replican con alguien de quien sólo hay una reunión de incorporación y sus mensajes.

| Paso | Qué se hace | Criterio |
|---|---|---|
| 1 | Agregar sus unidades y extraer sus filas | Cada pedido con sus dimensiones |
| 2 | Correr `analyze`: sus pedidos caen en las áreas existentes o piden una nueva con los cuatro criterios | Si cumple los cuatro nace el área; si no, su trabajo entra al área más cercana |
| 3 | Redactar su perfil con `propose` y corregirlo con la persona | Ninguna palabra de la reunión en el perfil |
| 4 | Correr el experimento con 20 pedidos donde el valor es suyo y 20 donde no | Lo incluye cuando el valor es suyo y no lo incluye en los otros; el umbral lo fija el equipo |
| 5 | Comparar su perfil completo con uno de una línea en la misma corrida | El completo no puntúa menos en los indicadores |
| 6 | Pedir a la persona que marque lo que no la describe | Una corrección por cláusula como máximo |

## 11. Evaluación del trabajo

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

## 12. Archivo de carga

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
| `--holdout` (experimento) | 0,5 | Partición 50 / 25 / 25 de Hastie, Tibshirani y Friedman (2009), sección 7.2 |
