# Error directo medido en el feedback pasado, 2026-10-23

Resultado: con la plantilla «Error directo v2», el analizador marcó «sí» en 22 de 70 pedidos de la reserva y 20 eran arreglos directos: precision 90,9 % (intervalo 72-97), recall 47,6 %. La reserva no se usó para derivar los criterios. Un ajuste hecho con el entrenamiento (v2.1) dio las mismas cifras, y se conserva v2.0. Los dos errores del «sí» eran pedidos que parecían fallas y ocultaban una decisión de producto. Gasto de la tarea: 4,43 USD de 6.

## Método

- Historial: 220 pedidos de un cliente (documentos de feedback, chats, audios y videos transcritos, hallazgos de jueces, tabla de pedidos, mesa de trabajo), cada uno con su desenlace medido contra el historial de cambios y el registro de decisiones del cliente. Los datos reales viven en `bench/private/error-directo/` y no se versionan.
- Desenlaces: a, arreglo con cambio de código o configuración sin decisión previa; b, necesitó una decisión (existe una decisión registrada o una pregunta contestada antes de actuar); c, funcionalidad nueva; d, pregunta o dato externo; e, no se atendió; sin dato.
- Rasgos del pedido: asignados leyendo solo el texto, antes de buscar el desenlace.
- Separación: 60 % entrenamiento y 40 % reserva, estratificada por desenlace, semilla fija. Los criterios salen de las cifras del entrenamiento. El analizador se midió sobre la reserva. Entran en la medición los desenlaces a, b, c y d; e y sin dato no se enviaron.
- Analizador: plataforma desplegada, modelo `claude-sonnet-5-5`, un texto por pedido enviado a `POST /api/inputs`. Un pedido cuenta como «sí» si todos sus mensajes dicen «sí» (lectura estricta). La lectura «alguno» da cifras casi iguales.
- Script: `bench/error-directo.mjs`.

## Historial

| Desenlace | Pedidos | Entrenamiento | Reserva |
|---|---:|---:|---:|
| a, arreglo directo | 104 | 62 | 42 |
| b, necesitó una decisión | 41 | 25 | 16 |
| c, funcionalidad nueva | 24 | 14 | 10 |
| d, pregunta o dato externo | 6 | 4 | 2 |
| e, no se atendió | 4 | 2 | 2 |
| Sin dato | 41 | 25 | 16 |
| Total | 220 | 132 | 88 |

Por insumo: documentos de feedback 93, chats 51, audio o video 27, hallazgos de jueces 23, tabla de pedidos 19, mesa 4, reuniones 3. Los hallazgos de jueces concentran 17 de los 41 sin dato: el registro dice «hecho» sin commit.

## Qué predice «arreglable sin decisión»

Cifras del entrenamiento: 105 pedidos con desenlace a, b, c o d (62 son a).

| Rasgo del pedido | Pedidos | Arreglo directo |
|---|---:|---:|
| Tipo falla, texto, dato, cálculo o pantalla que no responde o se ve mal | 48 | 91,7 % |
| Tipo capacidad nueva («agregar», «que haya», «la posibilidad de») | 38 | 26,3 % |
| Tipo regla de negocio cambiada | 9 | 55,6 % |
| Cuenta lo que ocurre o se ve | 64 | 81,2 % |
| Toca precio, descuento, abono, plazo o política | 22 | 40,9 % |
| Plantea dos o más caminos o una pregunta abierta | 18 | 38,9 % |
| Ocurre en una integración con un servicio externo | 10 | 20,0 % |
| Ocurre en permisos o roles | 5 | 40,0 % |
| Ocurre en un texto o rótulo | 4 | 100 % |
| Ocurre en infraestructura (límites, sesiones, avisos) | 4 | 100 % |
| Texto de más de 60 palabras | 11 | 27,3 % |
| Dice con precisión qué debería pasar | 66 | 57,6 % |
| Trae captura | 50 | 64,0 % |

La expectativa explícita y la captura casi no separan: el 59 % base ya es ese valor. El tipo de falla es el predictor dominante.

Reglas contra el desenlace, con los rasgos asignados por lectura:

| Regla | Entrenamiento | Reserva |
|---|---|---|
| Solo el tipo (falla, texto, dato, cálculo, pantalla) | 44 de 48 (91,7 %), recall 71,0 % | 33 de 36 (91,7 %), recall 78,6 % |
| Las cinco condiciones de la plantilla | 33 de 37 (89,2 %), recall 53,2 % | 30 de 32 (93,8 %), recall 71,4 % |

## Tamaño y zona de los arreglos directos

Sobre los 62 arreglos directos del entrenamiento. Las líneas por pedido dividen las del commit entre los pedidos que lo citan, porque 22 de los 62 comparten commit con tres o más pedidos.

| Medida | Valor |
|---|---|
| Líneas de código por pedido (mediana, cuartiles) | 119 (84 a 288) |
| Con 15 líneas o menos | 6 de 62 |
| Con 60 líneas o menos | 10 de 62 |
| Pedidos que acabaron en arreglo directo, por archivos tocados: 1 a 3 / 4 a 8 / más de 8 | 83 % / 71 % / 50 % |
| Días entre el pedido y el primer commit (mediana) | 0; 53 de 61 en un día o menos |
| Incluyen una prueba | 47 de 62 |
| Tocan una migración | 22 de 62 |
| Tocan archivos de datos de personas | 31 de 62 |
| Tocan pagos | 16 de 62 |
| Tocan un servicio externo | 7 de 62 |
| Pasaron por un juez, según el mensaje del commit | no medible: 1 de 104 lo registra |

Una migración, datos de personas o pagos no vuelven decisión a un pedido (de los 16 pedidos con zona de pagos asignada por lectura, 13 fueron arreglo directo). Sí cambian la revisión: más de un tercio de los arreglos directos tocó una migración, así que prohibir la zona costaría más de un tercio del recall.

## Falsos amigos

| Parecía | Era | Frecuencia en el entrenamiento |
|---|---|---|
| Una falla | Una decisión de producto o un choque con una decisión ya tomada | 2 de 48; otros 2 de 48 mezclaban la falla con una capacidad nueva o con un dato externo |
| Una capacidad nueva | Un arreglo directo: la capacidad existía, faltaba ubicarla o rotularla, o el dato ya viajaba y no se mostraba | 10 de 38 |
| Un cambio grande | Una línea a tres líneas | 6 de 62 arreglos con 15 líneas o menos |
| Un cambio pequeño | Un cambio mayor: la causa era general y alcanzaba a varias pantallas o varios pedidos | 2 casos: dos pedidos con una causa común y un pedido cuyo síntoma ocultaba una falla general |
| Un pedido de cambio de texto o de lugar | Una decisión ya registrada con condición de reversión | 1 |

## Definiciones

Error directo arreglable por IA desatendida: pedido que cumple a la vez cinco condiciones. Existe (se trata de algo que ya está o se acordó entregar y falla, se ve mal, dice algo equivocado o calcula mal). Está observado (cuenta qué ocurre o se ve). Tiene una sola salida comprobable. Es autocontenido (no espera un archivo, una cuenta o una respuesta de otra persona, ni depende de un servicio externo). No choca con una decisión registrada.

Lo que merece que lo mire una persona: un pedido que incumple cualquiera de las cinco. Las cuatro vías observadas son capacidad que nunca existió, elección entre caminos o regla de negocio, dependencia de un servicio externo o de permisos, y dato o archivo que debe entregar otra persona. Las zonas de pagos, datos de personas, migraciones, servicios externos y permisos no vuelven un pedido «no», pero exigen revisión de una persona antes de fusionar.

## Por qué está cada criterio

| Criterio en la plantilla | Cifra que lo sostiene |
|---|---|
| Condición 1, existe | 91,7 % de arreglo directo para el tipo falla contra 26,3 % para capacidad nueva |
| Condición 2, observado | 52 de 64 (81,2 %) contra 10 de 41 (24,4 %) en los pedidos que no cuentan lo observado |
| Condición 3, una sola salida | 40,9 % con negocio y 38,9 % con opciones, contra 59 % base |
| Condición 4, autocontenido | 20,0 % de arreglo directo en integraciones (2 de 10) |
| Condición 5, sin choque con lo decidido | 2 de los 4 errores del tipo falla eran decisiones registradas |
| Duda hacia la persona | Precision primero: el recall de la regla en la reserva (71 %) sostiene el costo |
| Dos casos fijos en «en parte» (algo falta o se perdió) | 10 de 38 reclamos de que algo falta eran arreglos; 2 de 48 de que algo se perdió eran decisiones |
| Examinar antes de cambiar (existe, decisión registrada, causa general) | Los tres falsos amigos de la tabla anterior |
| Detener con más de 8 archivos, pantalla nueva o tabla nueva | 50 % de arreglo directo con más de 8 archivos contra 83 % con 1 a 3 |
| Prueba que falla primero | 47 de 62 arreglos directos incluyeron prueba |
| «Zona tocada» y revisión previa a la fusión | 22 migraciones, 31 de datos de personas y 16 de pagos en 62 arreglos directos |

## Validación en la reserva

70 pedidos, 42 son arreglo directo. Precision y recall de «sí» contra el desenlace a.

| Versión | Lectura | Verdaderos positivos | Falsos positivos | Falsos negativos | Precision | Recall |
|---|---|---:|---:|---:|---:|---:|
| v2.0 | Todos los mensajes «sí» | 20 | 2 | 22 | 90,9 % (72-97) | 47,6 % |
| v2.0 | Algún mensaje «sí» | 22 | 2 | 20 | 91,7 % | 52,4 % |
| v2.0 | «Sí» o «en parte» | 29 | 2 | 13 | 93,5 % (79-98) | 69,0 % |
| v2.1 (ajuste) | Todos los mensajes «sí» | 20 | 2 | 22 | 90,9 % | 47,6 % |
| v2.1 (ajuste) | «Sí» o «en parte» | 25 | 2 | 17 | 92,6 % (77-98) | 59,5 % |

En el entrenamiento, v2.0 dio 18 de 18 (100 %, intervalo 82-100) con recall 29,0 % en «sí», y 42 de 46 (91,3 %) con recall 67,7 % en «sí» o «en parte». Es una cifra optimista: los criterios salen de esos pedidos.

Los 22 arreglos que el analizador no marcó «sí»: 13 «no» y 9 «en parte». En el entrenamiento, los bloqueos citados fueron «opciones» (17), «dato faltante» (9), «nada» (8), «regla de negocio» (5) y «capacidad nueva» (5).

Los dos falsos positivos: una falla de acceso a un registro, cuya corrección fijó una regla de permisos, y un contador que no baja, cuya corrección redefinió qué cuenta el número. Los dos tenían una decisión registrada de por medio y ningún indicio en el texto.

El ajuste v2.1 flexibilizó las condiciones 2 y 3 y la regla de la duda tras ver los bloqueos del entrenamiento. No cambió la precision ni el recall de «sí», y bajó el de «sí» o «en parte». La diferencia de un pedido son 2 a 4 puntos, dentro del ruido entre corridas. v2.1 se descartó. La reserva se usó dos veces: elegir entre v2.0 y v2.1 con ella es una selección, aunque aquí ambas dan lo mismo.

## Costo y tiempo por pedido

| Corrida | Pedidos | USD por pedido | Mediana (s) | Percentil 90 (s) |
|---|---:|---:|---:|---:|
| Reserva v2.0 | 70 | 0,0164 | 9,7 | 15,3 |
| Entrenamiento v2.0 | 105 | 0,0182 | 9,3 | 12,4 |
| Reserva v2.1 | 70 | 0,0175 | 9,6 | 15,3 |

Cuatro pedidos en paralelo, caché de prefijo activa.

## Límites

- Los informes de los agentes que armaron el historial describían casos de ambos conjuntos antes de la separación. Ninguna cifra ni ejemplo de los criterios sale de la reserva.
- Un solo cliente y 220 pedidos. Con 22 predicciones «sí», un pedido mueve la precision 4,5 puntos.
- El desenlace «a» mide que se arregló sin decisión previa registrada. No mide que el arreglo haya quedado bien: 1 de 104 registra una revisión independiente, y la reapertura no es medible en el registro.
- Varios arreglos viajaron en commits que cubren muchos pedidos, por lo que el tamaño por pedido es una estimación.
- Los desenlaces y los rasgos los asignaron agentes leyendo el historial; las evidencias se comprobaron contra el repositorio, pero la decisión «hubo decisión previa» es una lectura.
- El analizador no ve el código ni el registro de decisiones al clasificar. Lo que se oculta tras una falla aparente solo se detecta en la etapa «Salida», que obliga a examinar antes de cambiar.
- Los criterios coinciden con las reglas de delegación del autor en otro proyecto: datos de personas y dinero van a revisión, y lo reversible y ruidoso se delega. No se midió esa coincidencia contra datos.

## Cómo repetirlo

```sh
source ~/.config/team-platform/vps-admin
node bench/error-directo.mjs setup --area docs/plantillas/area-error-directo.md --template docs/plantillas/error-directo.md --title "Error directo v2"
node bench/error-directo.mjs run --items bench/private/error-directo/reserva.jsonl --out bench/private/error-directo/res.jsonl --label reserva
node bench/error-directo.mjs score --items bench/private/error-directo/reserva.jsonl --results bench/private/error-directo/res.jsonl
node bench/error-directo.mjs teardown --state bench/private/error-directo/vps-state.json
```
