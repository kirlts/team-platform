# Evaluación de interfaz con jueces acotados en octubre de 2026

Consultado el 2026-10-21. El número entre corchetes remite a la tabla de fuentes del final. Ventana pedida: últimos 12 meses, es decir desde 2025-10-21. Las fuentes anteriores a esa fecha se marcan como tales en la tabla y sólo se usan donde no hay una más reciente. «Sin verificar» marca lo que se leyó únicamente en el resumen de un buscador o en un agregador y no en la página original. El buscador sólo devuelve resultados de Estados Unidos y gran parte de lo publicado en 2026 son preprints sin revisión de pares y blogs de proveedores; cuando una cifra sólo aparece ahí, se dice.

Alimenta la decisión de cómo se evalúa la interfaz: pasar de un juez que revisa todo (9 a 14 minutos, repite hallazgos ya refutados) a varios jueces acotados en paralelo, alimentados con detectores automáticos y telemetría de uso.

## 1. Resumen

Hay evidencia directa de que un modelo multimodal aproxima el juicio humano sobre interfaces de forma moderada: correlación de Pearson de 0,69 a 0,73 con puntajes humanos y 72 a 77 % de aciertos dentro de ±1 punto en una escala de 1 a 7, pero sólo 35 a 38 % de aciertos exactos y casi azar en facilidad de uso [2]. Esa fuente es de 2025-10-09, doce días fuera de la ventana. Los sesgos conocidos dependen del modelo: el de posición medido en 2026 es pequeño (hasta 0,04), el de estilo es el mayor (0,10 a 0,76) y el de longitud cambia de signo según el proveedor [1].

No se encontró ningún estudio que compare, sobre interfaces, una llamada larga contra varias llamadas acotadas por pantalla o por criterio. Lo que existe es indirecto: el rendimiento de los modelos cae al crecer la entrada [10], un sistema de un agente coordinador con subagentes superó en 90,2 % a un agente solo en investigación, y casi toda la ganancia se explica por tokens gastados [11]. El mismo informe dice que la programación es un caso menos favorable que la investigación [11].

Sobre notas: la inflación existe y está documentada en jueces LLM [7] [8] [9]. No se encontró una fuente que mida el efecto de una «nota por omisión baja». Sí hay evidencia a favor de exigir una justificación por componente de la nota [9] y de fijar la rúbrica y exigir evidencia citada antes de puntuar [3] [6].

Sobre el anclaje, que es el riesgo de darle al juez la decisión previa: un puntaje anterior en el contexto desplaza los siguientes (d de Cohen hasta 0,71) y ni la cadena de pensamiento ni la orden de ignorarlo lo eliminan [5]. Dar restricciones no es dar un puntaje, pero el mecanismo es parecido y debe medirse en este proyecto.

## 2. LLM como juez de interfaces y salidas visuales

### 2.1 Acuerdo con humanos

| Fuente | Qué midió | Resultado |
|---|---|---|
| [2] (2025-10-09) | Tres modelos multimodales contra 9.296 respuestas humanas sobre 30 interfaces | Pearson 0,69 a 0,73; ±1 punto en 72 a 77 %; exacto en 35 a 38 %; en preferencia entre pares 59,98 % (Claude) y 59,60 % (GPT-4o), con Llama en 52,96 %; casi azar en «facilidad de uso». Los modelos puntúan más alto que los humanos en facilidad de uso (6,89 contra 6,21 en el caso de Claude) |
| [1] (2026-04, revisado 2026-06) | Nueve estrategias de reducción de sesgos, cinco jueces, tres bancos de pruebas | Un juez de gama media con la estrategia combinada llegó a 71,0 % de acuerdo (κ = 0,549) por unos 0,001 USD por evaluación; el mejor juez de frontera, 69,5 % por unos 0,015 USD. No queda claro en la página si la referencia son etiquetas humanas |
| [17] (CHI EA 2026) | Juez LLM sobre accesibilidad semántica, con 721 fallas inyectadas | Recall de 80 a 92 % sobre fallas inyectadas; κ de 0,69 a 0,94 contra la verdad curada, y 0,23 para los humanos. Los autores advierten que las fallas inyectadas pueden ser más limpias que las reales y que la prueba humana fue de cuatro personas |
| [15] (2025-07) | Evaluación heurística con modelos multimodales contra cinco profesionales, dos aplicaciones | El modelo encontró 73 % y 77 % de los problemas; los cinco humanos, 57 % y 63 %. Más fuerte en diseño de la página, más débil en convenciones y en violaciones que abarcan varias pantallas. No informa falsos positivos |
| [19] (sin verificar) | Banco de 1.395 interfaces con diseñadores | Acuerdo moderado en puntaje estético; éxito de la cadena completa de diagnóstico de 24,7 % como máximo |

Contradicción declarada. [17] y [15] muestran modelos que igualan o superan a los humanos, mientras [2] y [19] muestran acuerdo exacto bajo. La diferencia está en la tarea: encontrar fallas con una definición operativa (etiqueta ausente, problema de diseño de la página) es más fácil que predecir una percepción subjetiva o diagnosticar la causa. Además [17] usa fallas inyectadas y [15] no mide falsos positivos. Para este proyecto importa la primera clase de tarea, pero ninguna de las dos fuentes prueba que los hallazgos reportados sean válidos.

Un hallazgo de método que afecta toda comparación: el acuerdo reportado cambia con decisiones de protocolo. En una prueba con 2.007 decisiones pareadas, la exactitud pasó de 0,551 a 0,899 entre 24 configuraciones de protocolo, con κ entre −0,067 y 0,068 en todas [4]. Antes de comparar números hay que fijar escala, reglas de exclusión y forma de agregar.

### 2.2 Sesgos y mitigaciones demostradas

El estudio de [1] mide cuatro sesgos y es la fuente más completa dentro de la ventana. El sesgo de posición fue de hasta 0,04, pequeño. El de estilo (preferir markdown a prosa) osciló entre 0,10 y 0,76 y los autores lo llaman dominante. El de longitud depende del proveedor: Gemini y Llama prefieren respuestas largas (+0,24 a +0,44), Claude prefiere las concisas (−0,12) y GPT-4o es casi neutro (−0,04) [1]. La autopreferencia no aparece en el texto leído de [1]; un resumen de buscador la describe como heterogénea según el proveedor, sin verificar.

Las mitigaciones con efecto medido en [1] son estrategias combinadas de reducción de sesgos, con ganancias de 4,5 a 11,5 puntos porcentuales que sobreviven la corrección por comparaciones múltiples. [1] concluye que un modelo de gama media bien configurado puede igualar a uno de frontera. En rúbricas, [3] (aceptado en EMNLP 2026) fija la rúbrica de la tarea, exige juicios estructurados que citen evidencia y calibra a los límites de la escala humana; informa más acuerdo con humanos en la mayoría de los escenarios y más estabilidad ante reformulaciones de la rúbrica, sin dar cifras en el resumen. Los autores afirman que la ganancia viene de la combinación y no de un ajuste posterior [3].

Con varios jueces, [8] (taller de NeurIPS 2026) encuentra que los modelos más capaces reciben juicios más indulgentes (r ≥ 0,83) y propone ponderar jueces por sus tasas de falsos positivos y negativos estimadas del desacuerdo entre ellos, sin etiquetas humanas. En simulación queda a 0,5 puntos porcentuales de un oráculo [8]. Es una simulación, no un resultado sobre interfaces.

Un límite de la votación: en [12], diez revisores adversariales avalaron por unanimidad una vulnerabilidad que no existía, y una sola prueba empírica la mató. El acuerdo entre jueces no valida un hallazgo; una medición o una reproducción sí.

## 3. Varias llamadas acotadas contra una larga

Evidencia directa sobre interfaces: ninguna encontrada. Evidencia indirecta:

La degradación con el largo de la entrada es consistente en 18 modelos, incluidos Claude 4, GPT-4.1 y Gemini 2.5. En un banco de memoria conversacional, los modelos puntuaron mejor con un aviso enfocado de unos 300 tokens que con el completo de unos 113.000. Un solo distractor ya baja la exactitud y cuatro la bajan más [10]. La fuente es de 2025-07-14, fuera de la ventana, y sus curvas no dan porcentajes exactos.

Anthropic informa que un coordinador con subagentes superó en 90,2 % a un agente solo, que el uso de tokens por sí solo explica el 80 % de la varianza en BrowseComp y que un sistema multiagente gasta unas 15 veces los tokens de un chat [11]. La fuente es de 2025-06-13. Su lección sobre el encargo es útil aquí: una instrucción breve hizo que los subagentes duplicaran trabajo, y se corrigió con objetivo, formato de salida y límites explícitos [11]. Afirma además que la programación tiene menos subtareas paralelizables que la investigación [11]; una revisión de pantallas es, por construcción, más parecida a la investigación, porque cada pantalla es independiente.

Contradicción declarada. [11] atribuye la ganancia sobre todo a gastar más tokens, no a la estructura. Si eso aplica aquí, dividir en jueces acotados mejoraría el tiempo de pared (los jueces corren a la vez) pero no necesariamente el costo. Para este proyecto la ganancia que se busca es de tiempo, y esa sí es consistente con el paralelismo. La ganancia de precisión hay que medirla (sección 8).

En revisión de código, ReviewBench mide precisión y recall con hallazgos «fundamentados» sobre 219 solicitudes de cambio en 33 configuraciones [13]; las cifras por configuración no se leyeron. La pipeline de [12] muestra que un filtro adversarial mató alrededor del 79 % de 171 candidatos antes de divulgarlos, lo que sugiere que la tasa de hallazgos falsos de un revisor sin filtro es alta; no hay línea base sin filtro. Un resumen de buscador sobre un estudio con cuatro agentes especializados informa que la exactitud sube de 32,8 % a 72,4 % al combinar agentes, con rendimientos decrecientes tras el segundo; sin verificar, y es un preprint [21].

## 4. Evaluación heurística, detectores y analítica

### 4.1 Cuántos evaluadores independientes

NN/g (2023) recomienda de tres a cinco personas que evalúen de forma independiente y sin ver los hallazgos de las demás hasta terminar, con una hora o dos cada una, y consolidar después [16]. No da la proporción de problemas encontrada. Dos resúmenes secundarios, que no son la fuente original, dan cifras distintas: alrededor de 75 a 80 % con cinco evaluadores, y alrededor de dos tercios en el trabajo original de Nielsen y Molich; una revisión en CACM añade que los individuos encuentran entre 20 y 51 % y que la regla de cinco no se generaliza a interfaces complejas con evaluadores novatos [20]. Todo esto es anterior a la ventana y está sin verificar en la fuente primaria. La conclusión que se sostiene: un evaluador solo encuentra una fracción baja, el aporte marginal decrece y la regla es una estimación de planificación, no una ley.

### 4.2 Modelos con detectores automáticos y analítica

No se encontró ningún estudio de 2025 o 2026 que combine agentes de IA, detectores como axe-core o Lighthouse y analítica de uso en una misma evaluación. Lo disponible es parcial. Los detectores reportan bien lo sintáctico (texto alternativo ausente, campo sin etiqueta) y no juzgan si el valor presente es significativo; un `alt="image"` pasa todas las revisiones [17]. Cobertura de los detectores: en 2021, axe-core encontró en promedio 57 % de los problemas contados por volumen, no por criterios de WCAG, y sus autores indican que priorizan no dar falsos positivos [18]. Es un estudio del proveedor, de 2021, sin réplica independiente encontrada.

En el sentido contrario, los modelos no prueban formas de interacción como lector de pantalla o teclado, y los problemas que abarcan varias pantallas se les escapan [15]. De ahí se sigue una división del trabajo coherente con lo que se propone: los detectores y la telemetría cubren lo medible, el modelo cubre lo semántico y de composición. El respaldo es indirecto: las fuentes dicen qué ve cada instrumento, no que combinarlos funcione mejor que cada uno solo.

Sobre la salida de los modelos como informe: [14] (UXBench, 2026-06-15) juzga un informe por si un agente reparador fijo puede mejorar la interfaz con él, y concluye que el rendimiento varía entre modelos y entre tipos de pantalla. Es la única métrica de «utilidad del hallazgo» encontrada.

## 5. Evitar repetir hallazgos refutados, anclaje y evaluación ciega

Restricciones en el encargo. No se encontró un estudio que mida cuánto reduce las repeticiones inyectar un registro de decisiones en el encargo. [11] muestra el caso contrario: sin límites explícitos, los agentes duplican trabajo. Es apoyo indirecto a declarar el alcance de cada encargo.

Anclaje. [5] (2026-08-26) pone un puntaje previo como metadato: en 192.000 evaluaciones intentadas, siete de ocho modelos se desplazaron hacia el ancla, con d de Cohen de hasta 0,71. En una prueba categórica con etiquetas humanas, el ancla bloqueó el 48 % de las correcciones de errores y cambió el 10,18 % de los juicios correctos hacia la etiqueta equivocada asignada. La cadena de pensamiento no redujo el efecto; la advertencia de ignorar el metadato no lo redujo, pero mejoró la exactitud pareada [5]. Los autores piden validar cualquier mitigación para el modelo y la tarea concretos [5]. Una lista de «hallazgos ya refutados» no es un puntaje previo, pero comparte el riesgo de sesgar el juicio hacia lo que se le muestra; con el modelo y la tarea de este proyecto no hay medición.

Evaluación ciega. [6] (2026-05-13) prueba intervenciones de pista (Blind, Truth, Flip, Placebo, Reveal-After) sobre 1.000 resúmenes y encuentra «racionalización sustancial anclada en la pista» cuando se cambian etiquetas o se añaden pistas irrelevantes. El protocolo «evidencia antes de preferencia» (bloquear notas de evidencia, luego puntuar, luego ordenar) mejora la invariancia a las pistas. Los números de la condición ciega no figuran en la página leída [6]. La implicación para el proyecto: no decir qué cambió es lo coherente con [5] y [6]; las restricciones se declaran como reglas del alcance, no como juicios previos.

Deduplicación. No se encontró un estudio de 2025 o 2026 sobre deduplicar hallazgos de un juez. Orientación de proveedores, sin fecha verificable: la similitud de embeddings sola tiende a fusionar de más, y se prefiere proponer candidatos con embeddings y confirmarlos con campos estructurados (pantalla, elemento, tipo de falla). Eso es una práctica de proveedores, no una medición, y se trata como diseño a probar.

## 6. Calibración de la escala de notas

La inflación está medida en tareas cercanas, no en interfaces. [7] (SIGIR 2026) encuentra que los jueces LLM sobrevaloran la relevancia de pasajes que no responden a la necesidad, a veces con alta confianza, y lo describe como un sesgo de todo el sistema; la página leída no da cifras ni mitigación. [8] muestra que la indulgencia crece con la capacidad del modelo evaluado. [9] (blog, 2026-07-31, muestra de 24 ejemplos) registra un «colapso hacia las notas altas»: 13 de 24 predicciones caen en [0,8; 1,0] contra siete de las etiquetas de expertos. Al reemplazar la rúbrica genérica por un desglose con puntos asignados a contenido central, contexto de apoyo y foco, el error absoluto medio bajó de 0,127 a 0,103, pero κ bajó de 0,830 a 0,655 y los falsos positivos subieron de dos a cuatro; el autor advierte que la muestra no permite generalizar [9]. La enseñanza es doble: desglosar la nota en componentes con justificación ayuda a combatir la inflación, y esa mejora puede costar otras métricas.

En [2], los modelos tienden a puntuar por encima de los humanos en facilidad de uso y producen notas más agrupadas, con menor desviación que las humanas. Es un caso de interfaces que confirma la indulgencia en una dimensión concreta, no una inflación general: otras dimensiones quedaron por debajo del humano.

No se encontró ninguna fuente que pruebe que fijar una «nota por omisión baja» reduce la inflación. La calibración con anclas humanas sí está formulada: un modelo con término de indulgencia y pendiente ajustado sobre un conjunto pequeño de puntajes humanos aparece en un preprint de 2026-05 (2605.09227), leído sólo en el resumen de un buscador, sin verificar. Lo que sí está respaldado por [3] y [6] es exigir evidencia citada antes de puntuar. Una fuente de 2026 sin verificar (resumen de buscador sobre arXiv 2604.24658) dice que un auditor LLM redondeaba hacia arriba hasta pasar el umbral de aceptación y sugiere calcular el veredicto de forma determinista desde la lista de hallazgos. La página del resumen abierta no lo confirmó: no se usa como apoyo, sólo se deja constancia.

## 7. Métricas y validación de un hallazgo

Las fuentes de revisión de código usan precisión «fundamentada» (parte de los hallazgos emparejados que son válidos) y recall «fundamentado» (parte de los problemas válidos conocidos que se encontraron), más variantes aumentadas que acreditan hallazgos válidos fuera de la referencia [13]. En ReviewBench el juez es otro modelo y la referencia puede estar incompleta [13]. La validación más fuerte que aparece es la empírica: una prueba que mata la hipótesis [12]. En interfaces eso equivale a reproducir con captura o a medir con un detector. [14] añade la métrica de utilidad: si un agente reparador mejora la interfaz con el informe.

Para comparar dos marcos, [4] exige declarar escala, reglas para abstenciones y salidas inválidas, cómo se agrega y la unidad de remuestreo, y reportar la tabla de confusión en lugar de una sola cifra.

## 8. Qué se recomienda para este proyecto

1. Un encargo por pantalla o flujo, con objetivo, formato de salida y límites escritos, y los jueces en paralelo; sin instrucciones breves, que producen trabajo duplicado [11] y con entradas cortas, porque el rendimiento cae al crecer la entrada [10].
2. Pasar a cada juez las salidas de los detectores (solapes, objetivos táctiles, contraste, escala tipográfica, desbordes) y la telemetría, y pedirle sólo lo que esos instrumentos no ven: significado de rótulos y composición [17] [15]. Los detectores cubren lo sintáctico y cuentan con una cobertura parcial [18].
3. Pedir una evidencia citada por hallazgo (captura, coordenadas, medida o dato de telemetría) y bloquearla antes de dar nota [3] [6].
4. Calcular la nota de forma determinista a partir de la lista de hallazgos validados, en lugar de pedir un número al juez, y desglosar cualquier nota que se pida en componentes con puntos justificados [9].
5. No usar acuerdo entre jueces como validación de un hallazgo: un hallazgo cuenta cuando se reproduce con captura o se mide [12].
6. Declarar las decisiones del dueño y los hallazgos refutados como reglas de alcance, no como veredictos previos, y medir en una corrida de prueba si anclan al juez antes de adoptarlas [5].
7. No decir qué se cambió [5] [6].
8. Si se agregan notas de varios jueces, ponderar por tasas de error estimadas del desacuerdo, no por promedio simple [8].
9. Usar un modelo de gama media para los jueces acotados antes de uno de frontera, y verificar con una muestra [1].
10. Deduplicar con una huella canónica (pantalla, elemento, tipo de falla) y revisar con similitud semántica sólo los candidatos; es diseño sin fuente de medición y se trata como hipótesis [sin fuente].
11. Mantener una muestra pequeña de anotaciones humanas para calibrar y reportar la tabla de confusión, no sólo el acuerdo [4] [8].
12. Tomar cinco jueces como referencia de planificación para pantallas complejas y no como garantía [16] [20]; la nota por omisión baja queda como práctica propia a medir, sin respaldo en las fuentes.

## 9. Qué medir al comparar el marco nuevo con el anterior

Los dos marcos se corren sobre las mismas pantallas, con el mismo modelo y la misma versión de la interfaz, y los hallazgos de ambos se validan con una misma regla antes de contarlos. Se reporta la tabla de confusión y no una sola cifra [4].

| Métrica | Definición | Dato que la sostiene |
|---|---|---|
| Hallazgos nuevos válidos por minuto de pared | Hallazgos válidos no vistos antes, divididos por el tiempo desde el lanzamiento hasta el último juez; con jueces en paralelo se mide el tiempo del más lento | Captura o medida reproducible; registro de hallazgos previos |
| Tasa de repetición | Parte de los hallazgos que ya estaban en el registro de decididos o refutados | Huella canónica y revisión de los casos dudosos |
| Tasa de refutación | Parte de los hallazgos que el dueño o una medición rechazan | Veredicto del dueño; reproducción o medición |
| Precisión y recall fundamentados | Válidos sobre emitidos; válidos encontrados sobre válidos conocidos | Conjunto de referencia, con la salvedad de que puede ser incompleto [13] |
| Utilidad | Si un agente reparador mejora la pantalla con el hallazgo | Método de [14] |
| Cobertura propia de los detectores | Parte de los hallazgos válidos que un detector ya había dado | Salida de los detectores; deja ver cuánto aporta el juez |
| Costo | Tokens por corrida y por hallazgo válido | [11] indica que el gasto en tokens explica gran parte del resultado |
| Estabilidad | Repetir cada corrida y contar el solapamiento de hallazgos válidos | Reproducibilidad entre corridas; [15] informa estabilidad en el tiempo |
| Distribución de notas | Histograma de notas contra una muestra anotada por una persona | Señal de inflación [9] [8] |
| Efecto de las restricciones | Misma corrida con y sin el registro de decididos, comparando hallazgos válidos perdidos | Prueba de anclaje del tipo de [5] |

## 10. Contradicciones y vacíos

[11] y [10] pertenecen a 2025 y quedan fuera de la ventana de 12 meses; no hay fuente dentro de ella que mida directamente la división de una evaluación en llamadas acotadas, y la conclusión de la sección 3 es una inferencia. [2] queda doce días fuera de la ventana. [15] y [16] y [18] son anteriores. Los resúmenes de [19], [20], [21] y de 2605.09227 vienen de un buscador y no se confirmaron. No se halló fuente para la nota por omisión baja ni para la deduplicación de hallazgos de un juez. Los sesgos de longitud contradicen la creencia general de que los jueces prefieren respuestas largas: el efecto cambia de signo según el modelo [1].

## Fuentes

Todas con fecha de acceso 2026-10-21.

| N.º | Fuente | Fecha de publicación | URL |
|---|---|---|---|
| 1 | Soumik, «Judging the Judges: A Systematic Evaluation of Bias Mitigation Strategies in LLM-as-a-Judge Pipelines» (arXiv 2604.23178; TMLR 2026) | 2026-04-25, v2 2026-06-24 | https://arxiv.org/abs/2604.23178 |
| 2 | «MLLM as a UI Judge» (arXiv 2510.08783) | 2025-10-09 (fuera de ventana por 12 días) | https://arxiv.org/html/2510.08783v1 |
| 3 | Hong et al., «From Rubrics to Reliable Scores» / Rulers (arXiv 2601.08654; EMNLP 2026) | 2026-01-13, v3 2026-09-09 | https://arxiv.org/abs/2601.08654 |
| 4 | Rao y Callison-Burch, «Agreement Metrics for LLM-as-Judge Evaluation» (arXiv 2606.00093) | v2 2026-07-31 | https://www.alphaxiv.org/abs/2606.00093 |
| 5 | Kapetanovic et al., «Anchoring Bias in LLM-as-a-Judge Systems» (arXiv 2608.25869) | 2026-08-26 | https://arxiv.org/abs/2608.25869 |
| 6 | Tapwal et al., «Faithful or Fabricated?» (arXiv 2605.23970) | 2026-05-13 | https://arxiv.org/abs/2605.23970 |
| 7 | Yu et al., «When LLM Judges Inflate Scores» (arXiv 2602.17170; SIGIR 2026) | 2026-02-19, v3 2026-04-27 | https://arxiv.org/abs/2602.17170 |
| 8 | Zhang et al., «A Study of LLM Judge Capability-Dependent Biases and Multi-Judge Ensemble for Bias Calibration» (taller NeurIPS 2026) | 2026 | https://neurips.cc/virtual/2026/178218 |
| 9 | TruLens, «From judge scores to evidence» (blog) | 2026-07-31 | https://www.trulens.org/blog/2026/07/31/from-judge-scores-to-evidence-improving-llm-evaluator-alignment/ |
| 10 | Chroma, «Context Rot» (informe técnico) | 2025-07-14 (fuera de ventana) | https://www.trychroma.com/research/context-rot |
| 11 | Anthropic, «How we built our multi-agent research system» | 2025-06-13 (fuera de ventana) | https://www.anthropic.com/engineering/multi-agent-research-system |
| 12 | Agarwal, «Refute-or-Promote» (arXiv 2604.19049) | 2026-04-21 | https://arxiv.org/abs/2604.19049 |
| 13 | ReviewBench (ficha en BenchLM, captura del 2026-10-19) | 2026 | https://benchlm.ai/md/benchmarks/reviewbench.md |
| 14 | Wang et al., «UXBench» (arXiv 2606.16262) | 2026-06-15 | https://arxiv.org/abs/2606.16262 |
| 15 | Zhong, McDonald y Hsieh, «Synthetic Heuristic Evaluation» (arXiv 2507.02306) | 2025-07-03 (fuera de ventana) | https://arxiv.org/abs/2507.02306 |
| 16 | NN/g, «How to Conduct a Heuristic Evaluation» | 2023-06-25 (fuera de ventana) | https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/ |
| 17 | Calò, Gurita y De Russis, «Measuring the Semantic Accessibility Gap in LLM-Generated Web UIs» (CHI EA 2026); leído por un resumen de terceros, el repositorio de la universidad dio 403 | 2026-04 | https://a11y-paradise.onrender.com/reviews/69e8d16a891b0e7c69dbcfff |
| 18 | Deque, «Automated Testing Study Identifies 57 Percent of Digital Accessibility Issues» | 2021-03-10 (fuera de ventana) | https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues |
| 19 | AUV-Bench, ficha en chatpaper (sin verificar; la fecha de la ficha no cuadra con hoy) | sin verificar | https://chatpaper.com/paper/351304 |
| 20 | Revisión en CACM sobre número de personas en evaluación de usabilidad (resumen de buscador, sin verificar) | sin fecha verificada | https://cacm.acm.org/research/number-of-people-required-for-usability-evaluation |
| 21 | CodeX-Verify (arXiv 2511.16708; resumen de buscador, sin verificar) | 2025-11 | https://arxiv.org/pdf/2511.16708v2 |
