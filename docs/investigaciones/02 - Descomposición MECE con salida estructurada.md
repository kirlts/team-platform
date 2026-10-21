# Descomposición MECE con salida estructurada

Consultado el 2026-10-20. Procedimiento de `standard-research`: estado actual, comparativa, crítica y migración por tema, fuentes de los últimos 12 meses, contradicciones declaradas. Las fuentes se citan como [F n] y su URL está en la sección 9. «Sin verificar» marca lo que no tiene fuente primaria o donde la fuente primaria no mostró el dato. La investigación alimenta una decisión de Martín: cómo se descompone un input heterogéneo en un conjunto MECE de mensajes, con velocidad y corrección (MASTER-SPEC §1, §7.5, §7.9, §7.11).

## 1. Salida estructurada por proveedor

### 1.1 Anthropic

La salida estructurada se pide con `output_config.format` de tipo `json_schema`. La herramienta estricta (`strict: true`) es un mecanismo aparte y ambos se combinan. El parámetro anterior `output_format` está obsoleto. Haiku 5.5 figura entre los modelos compatibles [F1].

| Característica | Valor documentado |
|---|---|
| Tipos | object, array, string, integer, number, boolean, null; `enum` sólo de escalares; `const`; `anyOf`; `$ref` interno; `allOf` sin `$ref` |
| `additionalProperties` | Debe ser `false` |
| Sin soporte | `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, `maxItems`, recursión, `$ref` externo |
| `minItems` | Sólo 0 o 1 |
| Herramientas estrictas por solicitud | 20 |
| Parámetros opcionales en total | 24 |
| Parámetros con tipo unión | 16 |
| Fallo por complejidad | 400 «Schema is too complex for compilation»; compilación con tope de 180 s |
| Primera solicitud con esquema nuevo | Latencia añadida; sin cifra en la documentación |
| Caché de la gramática | 24 horas desde el último uso; se invalida al cambiar la estructura del esquema o las herramientas; no se invalida al cambiar sólo `name` o `description` |
| Orden de propiedades en la salida | Las requeridas primero, luego las opcionales, cada grupo en el orden del esquema |
| Salida que puede incumplir el esquema | `stop_reason` `refusal` y `max_tokens` |
| Incompatibles | Citas, prefill |
| Alcance de la gramática | Sólo la salida directa; el razonamiento queda libre |

Fuente de la tabla: [F1]. La cifra de compilación de 50 a 200 ms viene de un blog sin fuente primaria [F10b] y queda sin verificar.

El orden de propiedades condiciona el esquema. Si el modelo debe escribir la evidencia antes de decidir la categoría, ambos campos deben ser requeridos, porque la API pasa los requeridos al principio [F1].

Cuatro hechos de Haiku 5.5 afectan la ruta rápida. El pensamiento es adaptativo, está encendido por omisión y cuenta contra `max_tokens` (hasta 128.000) [F3][F4]. Se apaga con `thinking: {"type": "disabled"}` en esfuerzo `low`, `medium` o `high` [F4]. Con el pensamiento apagado y salida JSON, el modelo puede omitir una llamada a herramienta que necesita. Anthropic propone agregar al sistema «The JSON output format applies to your final answer only» y midió que sube la proporción de JSON completos y correctos [F4]. Decirle al modelo que responda directo no detuvo su razonamiento en las pruebas de Anthropic [F4].

Haiku 5.5 corre clasificadores de seguridad que pueden devolver `stop_reason: "refusal"` (categorías `cyber`, `bio`, `frontier_llm`, `general_harms`). No tiene reserva en el servidor y reenviar la misma solicitud suele repetir el rechazo [F4]. Un equipo que reporta una vulnerabilidad produce inputs que pueden caer en `cyber`. El analizador necesita un proveedor de respaldo y un estado de trabajo que muestre la categoría.

### 1.2 Compatibles con OpenAI

La guía de OpenAI exige raíz objeto sin `anyOf`, todas las propiedades en `required` (lo opcional se emula con `null`) y `additionalProperties: false`. Permite 5.000 propiedades, 10 niveles de anidación, 120.000 caracteres entre nombres y valores de enum y 1.000 valores de enum. No admite `allOf`, `not` ni `if/then/else` [F9]. La primera solicitud con un esquema nuevo tiene latencia añadida y las siguientes no [F9].

Las cifras de esa latencia salen de hilos del foro: menos de 10 s para esquemas típicos y hasta un minuto para complejos, con recálculos de más de 60 s tras unos 120 s sin uso [F10]. Son anecdóticas, de 2024 y 2025, y la guía vigente no las confirma. Quedan sin verificar.

### 1.3 DeepSeek

El modo JSON acepta `response_format: {"type": "json_object"}`. Exige la palabra «json» y un ejemplo en el prompt, un `max_tokens` suficiente, y advierte que la API «puede devolver contenido vacío ocasionalmente» [F11]. No existe `json_schema` en esa página. El esquema estricto vive en las llamadas a herramientas en beta (`base_url` `https://api.deepseek.com/beta`, `strict: true` en cada función). Exige todas las propiedades requeridas y `additionalProperties: false`. Soporta `anyOf`, `$ref` y `$def`, y no soporta `minLength`, `maxLength`, `minItems` ni `maxItems` [F12]. Una guía de terceros habla de `json_schema` en DeepSeek [F10c]. Prevalece la documentación oficial.

La caché de contexto es de disco, por prefijo exacto, «de mejor esfuerzo», y se limpia tras horas o días sin uso. Sólo guarda la entrada [F13]. `deepseek-flash` cuesta 0,15 USD por millón de tokens de entrada sin caché, 0,003 con caché y 0,60 de salida fuera de hora pico, y el doble en hora pico [F14].

### 1.4 Matriz para el contrato de proveedor

| Capacidad | Anthropic Haiku 5.5 | Compatible con OpenAI | DeepSeek |
|---|---|---|---|
| Esquema por gramática | Sí, `output_config.format` | Sí, `json_schema` | Sólo en herramientas, beta |
| Propiedades opcionales | Sí, 24 en total | No, se emulan con `null` | No |
| Cardinalidad y longitud | Sin `maxItems`, `minLength`; `minItems` 0 o 1 | Disponibles en modelos base | Sin `minLength`, `maxLength`, `minItems`, `maxItems` |
| Temperatura | Sólo 1 o ausente | Según el modelo, sin verificar | Sin efecto en modo de razonamiento [F15] |
| Semilla | No documentada | `seed`, mejor esfuerzo [F17] | Sin verificar |
| Caché de prompt | Explícita; lectura a 0,01 USD por millón en Haiku 5.5 | Sin verificar en 2026 | De disco, mejor esfuerzo |

Consecuencia para §7.9: el compilador de plantillas recibe un perfil de proveedor. Con Anthropic, `required: false` pasa como propiedad opcional y cuenta contra el tope de 24. En perfiles que exigen todo requerido, pasa como unión con `null`. Ajv valida después con el esquema completo, porque el de gramática es un subconjunto.

## 2. Patrones de descomposición

### 2.1 Una llamada contra dos

La evidencia directa es delgada. Un trabajo de consultas automotrices (2026) midió 98 % de exactitud con 0,28 a 0,50 s y estima 1,6 a 2,8 veces de aceleración frente a un paso único. Su clasificador necesitó 17 a 20 ejemplos por categoría [F27a]. Un estudio de anotación de datos personales en tráfico HTTP halló que dos etapas igualan o superan levemente a una en unos conjuntos y pierden en otro [F27b]. Ambos operan con consultas cortas y clasificadores entrenados. No se trasladan a team-platform.

Lo estructural: cada plantilla define campos distintos, así que el esquema de la descomposición depende de la plantilla. Un esquema con la unión de todas choca con el tope de 16 uniones [F1]. La segunda llamada mantiene los esquemas estáticos y pequeños. Su costo es un primer token más. Con la mediana de Artificial Analysis para Haiku 5.5 en `low` (8,39 s al primer token y 171,3 tokens por segundo con 10.000 tokens de entrada) [F18], una clasificación de 50 tokens tarda cerca de 8,7 s. Esos 8,4 s incluyen el pensamiento. Cuánto baja con el pensamiento apagado no está medido por ninguna fuente.

Tres variantes entran al banco. A: dos llamadas, como en §7.5. B: una llamada con esquema genérico `{title, body, fields: [{name, value}]}` y validación posterior contra la plantilla elegida, sin garantía de gramática sobre campos requeridos. C: descomposición especulativa con la plantilla más probable en paralelo con el clasificador. Ninguna tiene medición publicada.

### 2.2 Mapa y reducción

LLM×MapReduce (ACL 2025) divide el documento en trozos, lee cada uno y agrega con un protocolo de información estructurada y calibración de confianza en contexto para resolver conflictos [F20]. La página consultada no da cifras ni nombra la etapa de colapso. El análisis de ruido de ICLR 2026 (v2, 2026-02-28) separa tres fuentes de fallo: dependencia entre trozos, confusión del modelo que crece con la longitud y pérdida al agregar. Afirma que un modelo más débil con trozos puede superar a GPT-4o con el input entero [F19]. El resumen no trae cifras.

El criterio práctico sale de esa separación. Un docx de 40 puntos tiene poca dependencia entre trozos y se parte bien por encabezados o ítems. Un monólogo retoma temas y pronombres lejanos, y partirlo suma ruido de tarea y de agregación. Se parte sólo donde la estructura trae fronteras. El monólogo va entero: el contexto de 1.000.000 de tokens lo permite [F6], con el precio de entrada de Haiku 5.5 subiendo de 0,10 a 0,50 USD por millón sobre 100.000 tokens [F2].

Cálculo con la mediana citada y 125 tokens de salida por mensaje (supuesto del autor). Cuarenta mensajes son 5.000 tokens: 29 s de generación y 37,6 s en una llamada. Cuatro trozos de 10 mensajes en paralelo generan 1.250 tokens cada uno, 7,3 s más 8,4 s al primer token, unos 15,7 s, 2,4 veces menos. Si la reducción es otra llamada de 150 tokens, el total sube a 25 s, 1,5 veces menos. Cada llamada de reducción suma un primer token, por lo que conviene que sea determinista (sección 3.3).

### 2.3 Consolidación y deduplicación

TaxCE (2026-08-31) incluye una etapa de deduplicación semántica en su construcción de taxonomías [F26]. Un resumen de búsqueda atribuye al trabajo que sin deduplicación global quedan temas solapados. La página no lo muestra y queda sin verificar. GraphRAG fusiona de forma determinista entidades con el mismo título y tipo, y el modelo resume sus descripciones en una; no deduplica más allá de esa clave [F36]. En team-platform existe una clave determinista si cada mensaje declara las unidades del input que cubre (sección 3.3).

## 3. Exhaustividad y exclusión mutua

### 3.1 Qué técnicas tienen medición

| Técnica | Evidencia | Costo | Fuente |
|---|---|---|---|
| Rescate: pedir sólo lo que faltó, pasando lo ya extraído | Relaciones de 321 a 450 (+40 %) y entidades de 403 a 447 (+11 %) con Llama-3.3-70B en cuatro artículos de Wikipedia. El brazo es acumulativo con resolución de alias y indexó 39 de 40 trozos | Una llamada más por trozo | [F21] |
| Extracción iterativa con puertas de validación | 90,42 % de exactitud por objeto y 97,10 % de F1 de extremo a extremo, contra 80,16 a 87,24 % de líneas base. Cifras del resumen | No declarado | [F28] |
| Doble pase y multiagente | Ninguna de 14 configuraciones superó al prompt único: F1 0,906 a 0,908 contra 0,918. Nombrar las categorías omitidas recuperó 48 de 61 falsos negativos en una llamada | Más llamadas, sin beneficio | [F22] |
| Autoconsistencia | +0,4 % en HotpotQA con 20 muestras y +1,6 % en MATH-500; tokens casi lineales; a veces baja | N veces | [F23] |
| Votación sobre recall | 93,2 % con un pase y 97,7 % con tres o más; sin mejora después; 3 a 6 veces el costo. Resumen de búsqueda | 3 a 6 veces | [F10d] |

Tres fuentes independientes coinciden. Un rescate dirigido rinde cuando el primer pase queda corto en prosa densa [F21][F28]. La votación y los pipelines de varios agentes rinden poco cuando el modelo ya resuelve el caso [F22][F23].

[F21] y [F22] parecen contradecirse: ganancia grande del segundo pase contra ninguna. La diferencia es la tarea. En [F22] el cuello de botella era la especificación del prompt, y nombrar las categorías omitidas lo cerró en una llamada. En [F21] la extracción abierta de relaciones no tenía una especificación comparable. Aquí la especificación es la plantilla. Lo primero que se mide es cuánto recupera un «Método» mejor escrito antes de pagar un segundo pase.

El costo en dinero no limita. Con 0,10 y 0,50 USD por millón de tokens de entrada y salida [F6], una descomposición de 6.000 tokens de entrada (3.000 en caché) y 5.000 de salida cuesta unos 0,003 USD (cálculo del autor). Tres muestras en paralelo cuestan menos de 0,01. Limita la consolidación: tres salidas exigen una regla determinista o una llamada de reducción.

### 3.2 Verificación con segunda llamada

Dos estudios de 2026 sugieren que la verificación sirve si es mecánica y acotada. Uno de cribado sistemático midió una tasa de cambio de decisión de 0,0 % cuando el modelo decide cuándo escalar a un segundo pase [F10e]. Un resumen de búsqueda del estudio de de-identificación indica que un segundo pase libre produjo falsos positivos inestables y que forzar JSON los eliminó [F22]. Ninguno de los dos textos se pudo leer en esos pasajes. Ambos quedan sin verificar.

### 3.3 Partición verificable por unidades numeradas

Hipótesis de diseño sin precedente publicado exacto. Todo extractor de §7.4 ya devuelve unidades: párrafos e ítems del docx, segmentos con marcas de tiempo de la transcripción, líneas de cada mensaje de una captura. La plataforma les asigna ids estables. El esquema pide, por mensaje, `unit_ids` con las unidades que lo sostienen y, en la propuesta, `discarded` con las unidades excluidas y un motivo breve, por ejemplo saludo o charla sin pedido.

El sistema calcula tres cosas sin interpretar texto. Solapes: ids en más de un mensaje, que violan la exclusión mutua. Huecos: ids que no están en ningún mensaje ni en `discarded`, que violan la exhaustividad. Mensajes sin unidades: mensajes de más. Ante un solape o un hueco, una segunda llamada recibe sólo el conflicto o las unidades faltantes y corrige en el mismo esquema, con el único reintento que ya fija §7.5.

Es compatible con §1.2. El sistema valida forma: ids que existen, intersecciones vacías, unión completa. No decide área, destinatario ni estado a partir del texto. `discarded` no es una categoría común. TaxCE advierte que un «Otros» o «Misceláneo» viola MECE [F26]. Aquí lo descartado se enumera por id y es auditable.

Con trozos disjuntos por unidad, la reducción es una concatenación sin llamada, porque dos trozos no comparten unidades. Si un pedido se repite en dos trozos, una llamada de fusión recibe títulos e ids, no textos, y devuelve grupos de ids.

Riesgos a medir. El modelo puede inventar o copiar mal ids: la validación lo detecta, la gramática no lo impide. Una unidad puede ser más gruesa que un punto, como un párrafo con dos pedidos. Para ese caso, una unidad compartida por dos mensajes es válida sólo si el modelo marca `split: true`. Que esto reduzca los falsos solapes está sin verificar.

## 4. Idempotencia

### 4.1 Garantía de cada proveedor

| Proveedor | Temperatura | Semilla | Garantía | Fuente |
|---|---|---|---|---|
| Anthropic Haiku 5.5 | Sólo 1 o ausente; otro valor devuelve 400. Los modelos 4.7 y posteriores aceptan sólo el valor por omisión | No documentada | Ninguna. La guía manda omitir los tres parámetros | [F3][F7] |
| OpenAI y Azure | Según el modelo, sin verificar | `seed` y `system_fingerprint`, mejor esfuerzo; un `max_tokens` mayor reduce el determinismo | Probabilística | [F17] |
| DeepSeek | Sin efecto en modo de razonamiento | Sin verificar | Ninguna declarada | [F15] |
| Pesos propios con núcleos invariantes al lote | 0 | n/a | 1.000 de 1.000 salidas idénticas, con costo de rendimiento | [F16] |

La causa está medida. Con Qwen3-235B-A22B-Instruct-2507, temperatura 0 y mil completaciones de 1.000 tokens, 80 resultaron distintas y la más frecuente apareció 78 veces. Todas coincidieron durante 102 tokens y divergieron en el 103. Con núcleos invariantes al lote las mil fueron idénticas. El costo, en Qwen3-8B con 1.000 secuencias, fue pasar de 26 a 42 s con un núcleo de atención mejorado (55 s sin optimizar). La multiplicación de matrices pierde cerca de 20 % frente a cuBLAS [F16]. La variación viene del tamaño de lote del servidor, que cambia con la carga, y no de la concurrencia de hilos [F16]. Ningún proveedor por API expone ese control. LLM-42 (arXiv 2601.17768) critica la solución por acoplar el determinismo al diseño del núcleo. Lo vi sólo en resumen de búsqueda.

### 4.2 Consecuencia para §1.3

El primer sentido de §1.3 (un mismo input no crea otro trabajo) se cumple con el hash. El segundo (la misma propuesta con la misma configuración) no se obtiene por muestreo con Haiku 5.5. Se reemplaza por dos garantías. Una propuesta generada se guarda y se devuelve igual mientras no cambien el input, las áreas, las plantillas, el equipo ni el modelo. La estabilidad de una regeneración se mide en el banco con repeticiones y se compara con un umbral medido. Un reanálisis explícito genera otra propuesta y no se espera que coincida.

### 4.3 Cómo se mide la estabilidad

| Medida | Resultado | Fuente |
|---|---|---|
| Kappa de Cohen entre variantes de prompt, por campo, con 17 banderas y 47 etiquetas | Mediana 0,69 y 0,68 para dos tamaños de modelo. Colapsar a binario elimina la mayor parte del desacuerdo. Cambiar de modelo reasigna la etiqueta dominante en casi la mitad de las notas; reescribir el prompt, en una de cada ocho. El modelo mayor baja la masa en categorías residuales de 44 % a 26 % | [F25] |
| Jaccard por pares sobre las afirmaciones extraídas en tres repeticiones | Medida usada; sin cifra leída | [F29a] |
| F1 de dos corridas del mismo modelo contra acuerdo entre anotadores | La afirmación de que dos corridas coinciden menos que dos expertos no se mostró en el resumen. Sin verificar | [F29b] |
| Variación de estado final de modelos locales | 14,3 % y 10 % de las notas en 7B y 8B. Resumen de búsqueda | [F29c] |

Tres lecciones. El esquema decide más que la redacción: reducir el espacio de valores colapsa el desacuerdo [F25], así que área y plantilla van como `enum` de la gramática, estático por plantilla. Cambiar de modelo mueve más que cambiar de prompt [F25], así que el banco se repite al cambiar de modelo y no sólo al editar una plantilla. Un campo puede ser estable y estar mal [F29d], así que la repetición se mide junto con la exactitud contra referencia. El estudio de de-identificación corrió cinco ensayos independientes por configuración, con McNemar, rangos con signo y bootstrap de 95 % [F22]. Cinco es el valor inicial de repeticiones.

## 5. Evaluación

### 5.1 Banco de referencia

El banco de §7.11 guarda inputs reales anonimizados con sus unidades numeradas. La referencia lista, por cada punto atómico, los ids de unidad que lo sostienen, el área y la plantilla esperadas. Cuatro tipos de input: captura de chat, docx de N puntos (con un caso de 40), transcripción de monólogo y texto corto. La referencia debe auditarse con las salidas de los modelos. En el estudio de de-identificación la referencia omitía 227 intervalos que los modelos detectaron bien y un experto confirmó [F22].

### 5.2 Puntaje MECE

No hay una métrica MECE estándar. Los trabajos de 2026 usan un juez de modelo sobre categorías hermanas para el solape y una medida de cobertura contra referencia [F26]. La definición de TaxCE no se pudo verificar en el resumen. Con unidades anotadas, el puntaje se calcula sin juez. G es el conjunto de puntos de referencia y P los mensajes propuestos.

| Medida | Definición | Detecta |
|---|---|---|
| Cobertura | Puntos de G con todas sus unidades dentro de algún mensaje de P, sobre el total de G | Exhaustividad |
| Repetición | Puntos de G cubiertos por dos o más mensajes, sobre el total de G | Exclusión mutua |
| Mensajes de más | Mensajes de P que no cubren ningún punto de G, sobre el total de P | Ruido |
| Partidos | Puntos de G repartidos entre mensajes sin quedar completos en ninguno | Un punto roto |
| Fusionados | Mensajes de P que cubren dos o más puntos distintos de G | Un mensaje con dos pedidos |
| Exactitud de área y plantilla | Coincidencia exacta con la referencia, por mensaje | Clasificación |

Las tres medidas de §7.11 son las tres primeras filas. «Partidos» y «fusionados» separan dos fallos que la repetición no distingue. Un juez de modelo con rúbrica se agrega sólo para lo que la aritmética no cubre, como si el cuerpo redactado conserva el contenido del punto. Un estudio de 2026 sobre jueces atómicos y holísticos advierte que la ventaja de descomponer el criterio puede venir de un prompt más largo [F10f]. Resumen de búsqueda, sin verificar. Todo juez de modelo se compara con uno holístico del mismo largo.

### 5.3 Marcos y cuál conviene a un repositorio Node

| Marco | Lenguaje y licencia | Aporte | Límite | Fuente |
|---|---|---|---|---|
| promptfoo | TypeScript y Node, MIT; `npx promptfoo@latest` | Aserciones JavaScript en archivo; `is-json` con esquema; `--repeat`; `--max-concurrency`; caché de disco de 14 días; salida csv, json, html, junit.xml; umbral y pesos | Es parte de OpenAI desde 2026-03-09; el README declara que sigue abierto y MIT | [F30][F37] |
| DeepEval | Python, Apache 2.0; carpeta `typescript` con integraciones | G-Eval y métricas propias | No es nativo de Node | [F31a] |
| Inspect AI | Python; la página no nombra la licencia; UK AI Security Institute y Meridian Labs | Datasets, solucionadores, calificadores; más de 20 proveedores | Sin soporte de Node documentado | [F31b] |
| autoevals | TypeScript y Python, MIT | Calificadores de lista y de JSON | La puerta por omisión pide `BRAINTRUST_API_KEY`; se evita con `OPENAI_BASE_URL` propio | [F31c] |

Recomendación. El puntaje vive en un módulo propio, `bench/score.js`, con pruebas de `node --test`: es aritmética de conjuntos y debe correr sin red. promptfoo lo invoca con una aserción JavaScript de archivo. Aporta lo que el módulo no tiene: matriz de modelo por esfuerzo por plantilla, `--repeat 5`, concurrencia, caché y reportes. El cambio de propietario se acota fijando la versión en `package-lock.json`. La aserción es una función plana y se traslada a otro runner. Los resúmenes que lo llaman la opción por omisión para equipos de producto [F10g] vienen en parte de proveedores competidores y no cuentan como fuente independiente. DeepEval e Inspect quedan fuera por lenguaje. autoevals no agrega nada que la aritmética no haga.

## 6. Plantillas en markdown con frontmatter

### 6.1 Precedentes

| Formato | Estructura | Esquema de salida | Fuente |
|---|---|---|---|
| Agent Skills, `SKILL.md` | Frontmatter con `name` (hasta 64 caracteres, igual al directorio), `description` (hasta 1.024), `license`, `compatibility` (hasta 500), `metadata` (mapa de cadenas), `allowed-tools`; cuerpo markdown | No lo define | [F32] |
| Dotprompt (Google) | Frontmatter con `model`, `config`, `input.schema`, `output.format`, `output.schema`; Picoschema, un YAML compacto que compila a JSON Schema | Sí, en el frontmatter | [F33] |
| Prompty (Microsoft) | Frontmatter YAML y cuerpo con Jinja2 o Mustache; en la versión 2, `outputs` se convierte en `response_format` | Sí, según el paquete .NET en resumen de búsqueda; la especificación de `outputs` no se leyó | [F34] |
| Plantillas de LangChain | Cadenas f-string, mustache o jinja2; no son archivos con frontmatter | Aparte, con Zod o Pydantic | [F10h] |
| Mastra | Sin resultados | Sin verificar | n/a |

La divulgación progresiva de Agent Skills coincide con las dos llamadas de §7.5. El estándar carga `name` y `description` de todas las skills al arrancar (unos 100 tokens cada una), el cuerpo sólo al activar una (recomendado bajo 5.000 tokens y 500 líneas) y los archivos de apoyo cuando hacen falta [F32]. La primera llamada de team-platform ve `name` y `description` de todas las plantillas y la segunda carga el cuerpo de la elegida. Con esos límites, la primera llamada pesa a lo sumo N por 1.024 caracteres de descripción. `fields` no existe en ese estándar y `metadata` sólo admite cadenas, así que `fields` va como campo propio del frontmatter.

Un precedente interno de un proyecto anterior del autor queda fuera: no es fuente pública y no se pudo citar con URL ni fecha.

### 6.2 De campos a esquema JSON

Una función pura, `src/analyze/schema.js`, recibe plantilla y perfil de proveedor y devuelve JSON Schema, probada contra los límites de la sección 1. Si el proyecto prefiere Zod, `z.toJSONSchema(schema)` genera draft 2020-12 por omisión, acepta `target` para draft-07, draft-04 y openapi-3.0, y lanza error con tipos sin equivalente (`bigint`, `date`, `transform`) salvo `unrepresentable: "any"` [F35]. Para campos de texto con etiqueta, el frontmatter YAML basta.

Forma del esquema de la propuesta para la gramática:

```json
{
  "type": "object",
  "properties": {
    "messages": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "properties": {
          "unit_ids": { "type": "array", "items": { "type": "integer" }, "minItems": 1 },
          "title": { "type": "string" },
          "fields": { "type": "object",
                      "properties": { "<campo>": { "type": "string" } },
                      "required": ["<campos requeridos>"], "additionalProperties": false },
          "assignee_ids": { "type": "array", "items": { "type": "integer" } },
          "attachment_ids": { "type": "array", "items": { "type": "integer" } }
        },
        "required": ["unit_ids", "title", "fields", "assignee_ids", "attachment_ids"],
        "additionalProperties": false
      }
    },
    "discarded": { "type": "array", "items": { "type": "object",
        "properties": { "unit_ids": { "type": "array", "items": { "type": "integer" } },
                        "reason": { "type": "string" } },
        "required": ["unit_ids", "reason"], "additionalProperties": false } }
  },
  "required": ["messages", "discarded"],
  "additionalProperties": false
}
```

`unit_ids` va primero dentro del mensaje para que el modelo ancle el mensaje a su evidencia antes de redactarlo. Todos los campos son requeridos, de modo que el orden de salida es el del esquema [F1]. No hay `maxItems`: el tope de mensajes por input lo impone el sistema. El esquema es estático por plantilla. Los ids de miembros y adjuntos son enteros que Ajv valida contra la base. Un `enum` por input cambiaría la estructura y obligaría a recompilar la gramática en cada llamada. La documentación dice que un cambio de estructura invalida la caché; que un cambio de valores de `enum` cuente como cambio de estructura no está declarado y queda sin verificar.

Efecto del esquema sobre la calidad. El estudio de 2024 halló que las restricciones de formato dañan el razonamiento y mejoran la clasificación [F24b]. El de 2026 atribuye casi toda la pérdida a la instrucción de formato y no al decodificador, indica que separar razonamiento de formato recupera casi todo y que los modelos cerrados recientes muestran poca o ninguna pérdida [F24a]. Las dos fuentes discrepan en la causa. Para el proyecto la acción es la misma: la gramática de Haiku 5.5 no aplica al pensamiento [F1], y el banco compara `low` con `medium` para decidir si el pensamiento compensa.

## 7. Caché de prompt

La jerarquía es herramientas, sistema y mensajes, y un cambio invalida su nivel y los siguientes. El mínimo cacheable de Haiku 5.5 es 512 tokens (4.096 en Haiku 4.5). La vida por omisión es de 5 minutos. La escritura cuesta 1,25 veces la entrada (2 veces con 1 hora) y la lectura 0,1 veces, 0,01 USD por millón en Haiku 5.5 [F2]. La página de salida estructurada dice que cambiar `output_config.format` invalida la caché de prompt de la conversación [F1]. La tabla de invalidación de la página de caché no lista ese parámetro [F2]. Las dos páginas se contradicen. Se resuelve leyendo `cache_read_input_tokens` en la segunda llamada de un mismo input, que usa otro esquema. Hasta entonces se supone que las dos llamadas no comparten caché.

Con equipos de 3 a 10 personas los inputs llegan espaciados y la caché de 5 minutos vence entre uno y otro. Escribir un sistema de 3.000 tokens cuesta 0,000375 USD en 5 minutos y 0,0006 en 1 hora (cálculo sobre [F2]). El valor de la caché es de latencia y ninguna fuente consultada lo cuantifica. Queda sin verificar hasta medir el primer token con y sin acierto.

La gramática se cachea 24 horas desde el último uso [F1]. Un calentamiento por evento, una solicitud mínima con el esquema al guardar o editar una plantilla, evita que el primer input real pague la compilación. Una plantilla que pasa 24 horas sin uso paga una compilación fría, y el banco la mide como caso aparte. No hace falta un reloj.

## 8. Lo que no se pudo verificar

| Pregunta | Estado | Cómo se cierra |
|---|---|---|
| Latencia de compilación de gramática en Anthropic | Sin cifra oficial | Medir la primera y la segunda llamada con un esquema real |
| Latencia de Haiku 5.5 con pensamiento apagado y salida estructurada | Sin medición pública | Banco: `low` adaptativo, `low` sin pensamiento, `medium` adaptativo |
| Caché de prompt compartida entre esquemas distintos | Contradicción entre [F1] y [F2] | Leer `cache_read_input_tokens` |
| Invalidación de la gramática por valores de `enum` | No declarado | Dos llamadas con el mismo esquema salvo los valores |
| Estabilidad de Haiku 5.5 sin control de muestreo | Sin cifra pública | Cinco repeticiones por input; Jaccard de unidades entre corridas |
| Que `unit_ids` reduzca solapes y huecos | Hipótesis propia | Comparar con una variante sin `unit_ids` |
| Semilla y temperatura de DeepSeek y de OpenAI vigentes | Sin verificar | Probar al agregar el proveedor |
| Tasa de `refusal` en inputs de seguridad | Documentado como posible | Contar rechazos con casos de vulnerabilidades |

Haiku 5.5 tenía unas dos semanas de vida pública el día de la consulta. Su retiro mínimo figura en 2027-10-07 [F6] y Artificial Analysis lo ubica en octubre de 2026 [F18]. Las cifras independientes de velocidad vienen de una sola fuente y cambian entre instantáneas: `low` marcó 6,28 s y 181,2 tokens por segundo en una consulta de búsqueda y 8,39 s y 171,3 al leer la página, y `medium` 12,63 s y 136,8 [F18]. No se pueden conciliar con lo disponible y se usan como rango.

## 9. Fuentes y contradicciones

Todas consultadas el 2026-10-20. Las páginas de Anthropic y DeepSeek no muestran fecha de publicación. Las de Anthropic mencionan modelos y fechas de 2026 y se tratan como vigentes.

| Id | Fuente | URL | Fecha |
|---|---|---|---|
| F1 | Anthropic, Structured outputs | https://platform.claude.com/docs/en/build-with-claude/structured-outputs | vigente |
| F2 | Anthropic, Prompt caching | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | vigente |
| F3 | Anthropic, Haiku 5.5 migration guide | https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide | vigente |
| F4 | Anthropic, Prompting Claude Haiku 5.5 | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5 | vigente |
| F5 | Anthropic, Effort | https://platform.claude.com/docs/en/build-with-claude/effort | vigente |
| F6 | Anthropic, Models overview | https://platform.claude.com/docs/en/about-claude/models/overview | vigente |
| F7 | Anthropic, Reducing latency | https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency | vigente |
| F9 | OpenAI, Structured Outputs | https://developers.openai.com/api/docs/guides/structured-outputs | vigente |
| F10 | Foro OpenAI, caché de esquema y latencia | https://community.openai.com/t/how-long-openai-keep-the-cached-converted-schema-for-structured-output/990380 | 2024 a 2025, anecdótico |
| F10b | Techsy, structured outputs (50 a 200 ms) | https://techsy.io/en/blog/llm-structured-outputs-guide | 2026, secundaria |
| F10c | macaron.im, DeepSeek V4 tool calling | https://macaron.im/en/blog/deepseek-v4-tool-calling | 2026, secundaria |
| F10d | arXiv 2609.13601, votación y recall | https://arxiv.org/pdf/2609.13601 | 2026-09, resumen de búsqueda |
| F10e | arXiv 2608.14551, cribado sistemático | https://arxiv.org/pdf/2608.14551 | 2026-08, PDF ilegible en la consulta |
| F10f | arXiv 2603.28005, jueces atómicos y holísticos | https://arxiv.org/pdf/2603.28005 | 2026-03, resumen de búsqueda |
| F10g | futureagi.com, marcos de evaluación 2026 | https://futureagi.com/blog/best-open-source-eval-frameworks-2026 | 2026, proveedor competidor |
| F10h | LangChain.js, prompts | https://reference.langchain.com/javascript/langchain-core/prompts | 2026, resumen de búsqueda |
| F11 | DeepSeek, JSON Output | https://api-docs.deepseek.com/guides/json_mode | vigente |
| F12 | DeepSeek, Tool Calls | https://api-docs.deepseek.com/guides/tool_calls | vigente |
| F13 | DeepSeek, Context Caching | https://api-docs.deepseek.com/guides/kv_cache | vigente |
| F14 | DeepSeek, Models y precios | https://api-docs.deepseek.com/quick_start/pricing | vigente |
| F15 | DeepSeek, Thinking Mode | https://api-docs.deepseek.com/guides/thinking_mode | vigente |
| F16 | Thinking Machines, Defeating Nondeterminism | https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/ | 2025-09-10 |
| F17 | OpenAI Cookbook y Azure, salida reproducible | https://developers.openai.com/cookbook/examples/reproducible_outputs_with_the_seed_parameter | 2023-11, resumen de búsqueda |
| F18 | Artificial Analysis, Haiku 5.5 | https://artificialanalysis.ai/models/claude-haiku-5-5-low/providers | medianas de 72 horas |
| F19 | Xu et al., divide y vencerás en contexto largo | https://arxiv.org/abs/2506.16411 | v2 2026-02-28 |
| F20 | LLM×MapReduce | https://arxiv.org/abs/2410.09342 | ACL 2025 |
| F21 | post-graph-rag, rescate | https://arxiv.org/html/2608.24921 | 2026-08-14 |
| F22 | Palacios et al., PHI institucional | https://arxiv.org/pdf/2608.17051 | 2026-08-17 |
| F23 | Loo, autoconsistencia | https://arxiv.org/abs/2511.00751 | v2 2026-05-07 |
| F24a | Format tax | https://arxiv.org/abs/2604.03616 | 2026-04-04 |
| F24b | Tam et al., Let Me Speak Freely | https://arxiv.org/abs/2408.02442 | 2024-08 |
| F25 | Sensibilidad de la extracción estructurada | https://arxiv.org/abs/2606.05970 | 2026-06-04 |
| F26 | TaxCE | https://arxiv.org/abs/2608.30614 | 2026-08-31 |
| F27a | Consultas automotrices modular | https://arxiv.org/pdf/2604.16301 | 2026-04, resumen de búsqueda |
| F27b | Anotación de datos personales en HTTP | https://arxiv.org/pdf/2605.06305 | 2026-05, resumen de búsqueda |
| F28 | Memoria con esquema, extracción iterativa | https://arxiv.org/abs/2604.27906 | 2026-04-30 |
| F29a | Estructura de razonamiento (Jaccard) | https://arxiv.org/pdf/2606.03883 | 2026-06, resumen de búsqueda |
| F29b | Extracción jurídica con control de citas | https://arxiv.org/abs/2607.03325 | 2026-07-03 |
| F29c | Estabilidad de esquema, modelos locales | https://doi.org/10.3390/healthcare14142150 | 2026, resumen de búsqueda |
| F29d | Fiabilidad de salidas estructuradas | https://cyberleninka.ru/article/n/reliability-of-structured-outputs-of-large-language-models-in-terms-of-logical-consistency-and-reproducibility/pdf | 2026, resumen de búsqueda |
| F30 | promptfoo, repositorio y documentación | https://github.com/promptfoo/promptfoo | 2026 |
| F31a | DeepEval | https://github.com/confident-ai/deepeval | 2026 |
| F31b | Inspect AI | https://inspect.aisi.org.uk/ | 2026 |
| F31c | autoevals | https://github.com/braintrustdata/autoevals | 2026 |
| F32 | Agent Skills, especificación | https://agentskills.io/specification | vigente |
| F33 | Dotprompt, frontmatter | https://google.github.io/dotprompt/reference/frontmatter/ | vigente |
| F34 | Prompty | https://github.com/microsoft/prompty | 2026, resumen de búsqueda |
| F35 | Zod, JSON Schema | https://zod.dev/json-schema | vigente |
| F36 | GraphRAG, flujo de datos | https://microsoft.github.io/graphrag/index/default_dataflow/ | vigente |
| F37 | OpenAI adquiere Promptfoo | https://qaskills.sh/blog/openai-promptfoo-acquisition-explained-2026 | 2026-03-09 |

Contradicciones declaradas. La caché de gramática dura 24 horas según Anthropic [F1]. Un hilo de OpenAI habla de recálculo tras unos 120 segundos [F10], y la guía de OpenAI dice que las solicitudes siguientes no pagan latencia [F9]. Son plataformas distintas y el hilo es anecdótico. Para Anthropic prevalece la documentación. Estructura y caché de prompt se contradicen entre [F1] y [F2] (sección 7). Sobre DeepSeek, una guía de terceros habla de `json_schema` y la documentación oficial lo limita a herramientas beta [F10c][F11][F12]. Huawei Cloud dice que la temperatura queda fija en 1,0 en modo de razonamiento y DeepSeek dice que se ignora sin error. Ambas caben en un servidor que ignora lo que recibe. Los estudios de 2024 y 2026 sobre el costo del formato discrepan en la causa [F24a][F24b]. El rescate rinde en [F21] y no en [F22] por la tarea (sección 3.1). Un resumen dice que el futuro de promptfoo tras la adquisición no está aclarado y el README dice que sigue abierto y MIT [F30][F37]. Se acota fijando la versión.

## 10. Recomendaciones y perillas

### 10.1 Recomendaciones

| Recomendación | Evidencia | Fuente, fecha |
|---|---|---|
| Quitar «temperatura cero» de §1.3, §3 y §7.5 para el proveedor por omisión. La temperatura pasa a capacidad del perfil de proveedor y se omiten los tres parámetros en Haiku 5.5 | `temperature` sólo 1, `top_p` sólo 0,99, `top_k` prohibido; 400 en otro caso | [F3], vigente, consulta 2026-10-20 |
| Idempotencia por persistencia (hash a propuesta guardada) y estabilidad medida con cinco repeticiones | Ningún proveedor garantiza identidad; 80 salidas distintas de 1.000 a temperatura 0; cinco ensayos en el estudio de de-identificación | [F16] 2025-09-10; [F22] 2026-08-17 |
| Esquema estático por plantilla, ids validados con Ajv, compilado por un módulo con perfil de proveedor | Gramática cacheada 24 h por estructura; 24 opcionales y 16 uniones; sin `maxItems` ni `minLength` | [F1], consulta 2026-10-20 |
| Calentar el esquema por evento al guardar una plantilla | Primera solicitud con esquema nuevo paga compilación; caché de 24 h desde el último uso | [F1], consulta 2026-10-20 |
| `unit_ids` por mensaje y `discarded`; solapes y huecos calculados por el sistema; una segunda llamada sólo sobre el conflicto | Hipótesis propia, apoyada en el rescate dirigido y en que un «Otros» viola MECE | [F21] 2026-08-14; [F26] 2026-08-31 |
| Mapa y reducción sólo con trozos disjuntos por unidad y reducción determinista; el monólogo va entero | Ruido de tarea, de modelo y de agregación; el monólogo depende de contexto lejano | [F19] 2026-02-28 |
| Medir las variantes A, B y C de §7.5 | No hay medición publicada que decida; la evidencia de dos etapas es mixta | [F27a][F27b] 2026 |
| Un pase de rescate como máximo; sin autoconsistencia por omisión | Rescate +40 % de relaciones en extracción abierta; ninguna arquitectura superó al prompt único con buena especificación; +0,4 % con 20 muestras | [F21] 2026-08-14; [F22] 2026-08-17; [F23] 2026-05-07 |
| `refusal` y `max_tokens` como estados del trabajo, con proveedor de respaldo y sin reintento idéntico del rechazo | Clasificadores de Haiku 5.5 sin reserva en el servidor; JSON incompleto con `max_tokens` | [F4], [F1], consulta 2026-10-20 |
| Puntaje por aritmética de conjuntos (cobertura, repetición, de más, partidos, fusionados) y referencia auditada con las salidas de los modelos | No hay métrica MECE estándar; una referencia omitía 227 intervalos | [F26] 2026-08-31; [F22] 2026-08-17 |
| Runner promptfoo con aserción JavaScript que importa `bench/score.js`, versión fijada | MIT, Node, `--repeat`, caché, junit; ahora de OpenAI y sigue MIT | [F30]; [F37] 2026-03-09 |
| `fields` como campo propio del frontmatter, con `name` y `description` bajo los límites de Agent Skills | 64 y 1.024 caracteres; `metadata` sólo admite cadenas; divulgación progresiva igual a las dos llamadas | [F32], vigente |
| Repetir el banco al cambiar el modelo, no sólo al editar una plantilla | Cambiar de modelo reasigna la etiqueta en casi la mitad de las notas; reescribir el prompt, en una de cada ocho | [F25] 2026-06-04 |

### 10.2 Perillas con valor por omisión

Todo número que gobierna la operación nace declarado (§4.9). «Provisional» indica que la fuente da una cota y el banco fija el valor.

| Perilla | Valor por omisión | Justificación | Fuente |
|---|---|---|---|
| Modelo | `claude-haiku-5-5` | Documentado para clasificación, extracción y enrutamiento de alto volumen; el más rápido de la línea | [F6] |
| `effort` de la clasificación | `low` | Nivel más barato y rápido, para tareas simples y de alto volumen | [F4][F5] |
| `effort` de la descomposición | `medium` hasta que el banco muestre que `low` conserva la cobertura | En `low` aumenta la omisión de comprobaciones en prompts largos; `medium` es el valor por omisión de Haiku 5.5 | [F4][F5] |
| `thinking` | Omitido (adaptativo) | Con pensamiento apagado y salida JSON puede omitirse una herramienta; el banco compara con `disabled` | [F4] |
| Línea de sistema con pensamiento apagado | «The JSON output format applies to your final answer only.» | Subió la proporción de JSON completos y correctos en `low` y `medium` | [F4] |
| `temperature`, `top_p`, `top_k` | Omitidos en Haiku 5.5; `temperature` 0 sólo en perfiles que lo aceptan | Otro valor devuelve 400 en Haiku 5.5 | [F3] |
| `max_tokens` | Provisional: 16.000, con un reintento a 32.000 si `stop_reason` es `max_tokens` | Techo 128.000; el pensamiento cuenta; Anthropic indica reintentar con más; el valor sale del p95 de salida por mensaje del banco | [F1][F3] |
| Reintentos por salida inválida | 1; un `refusal` no se reintenta igual | Ya fijado en §7.5; el rechazo suele repetirse | [F4] |
| Pases de rescate | 1, sólo si el cálculo de huecos no está vacío | Una llamada más por trozo; ganancia medida en extracción abierta | [F21] |
| Muestras de autoconsistencia | 1 (apagada) | +0,4 % con 20 muestras; costo lineal | [F23] |
| Calentamiento de esquema | Por evento al guardar o editar una plantilla | Gramática cacheada 24 h desde el último uso | [F1] |
| Umbral de partición del input | Provisional: 100.000 tokens de entrada | Frontera documentada de precio de Haiku 5.5; la latencia de salida sugiere bajarlo y el banco lo fija | [F2][F19] |
| Partición | Sólo por fronteras estructurales; monólogo sin partir | Ruido de dependencia entre trozos | [F19] |
| TTL de caché de prompt | 5 minutos | Valor por omisión del proveedor; pasar a 1 hora si el acierto medido con `cache_read_input_tokens` es bajo | [F2] |
| Tamaño mínimo del sistema cacheado | 512 tokens | Mínimo cacheable de Haiku 5.5 | [F2] |
| Repeticiones del banco | 5 | Cinco ensayos independientes en la comparación de arquitecturas | [F22] |
| Concurrencia del banco | `--max-concurrency` de promptfoo; sin valor fijado | Depende del límite de tasa de la cuenta; sin fuente, se fija al medir | [F30] |
| Proveedor de respaldo | `deepseek-flash` con herramienta estricta (beta) o modo JSON con validación Ajv | Haiku 5.5 sin reserva en el servidor; DeepSeek no recibe esquema en modo JSON | [F4][F11][F12] |
| Versión de promptfoo | Fijada en `package-lock.json` | Cambio de propietario el 2026-03-09 | [F37] |
