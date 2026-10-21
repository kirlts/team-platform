# Jueces acotados en paralelo contra el juez único por área

Medido el 2026-10-21. Comando: `node scripts/juicios.mjs preparar --out DIR --items home,message-detail,areas,settings,team,flow-send`, un subagente Sonnet por encargo, todos a la vez, y `node scripts/juicios.mjs consolidar --out DIR`. Los dos resultados completos quedaron en `~/.cache/claude-tmp/team-platform-juicios/medicion-1` y `medicion-2` (fuera del repositorio).

## Resultado

El tiempo de pared de una ronda baja de 9 a 14 minutos (un juez, medido por el dueño en esta sesión) a 88 y 130 segundos para seis pantallas y flujos. La proporción de hallazgos repetidos o ya decididos no baja: 28 % en la medición 1 y 29 % en la 2, contra 39 % en la ronda 3 del método anterior. Los jueces acotados no reportaron ningún hallazgo de severidad 4 o 5 y todas las notas quedaron en 2 o 3.

## Tiempos

| Etapa | Medición 1 | Medición 2 |
|---|---|---|
| Preparación: capturas y detectores a la vez, encargos | 78 s | 44 s |
| Jueces en paralelo, el más lento | 52 s | 44 s |
| Tiempo de pared de la ronda | 130 s | 88 s |
| Tiempo de cada juez | 37 a 52 s | 31 a 44 s |
| Ronda anterior, un juez | 540 a 840 s | |

La máquina tenía una carga de 39 durante la preparación de la medición 1 y de 7 durante la 2.

## Hallazgos

| | Medición 1 | Medición 2 | Ronda 3 anterior (libro) |
|---|---|---|---|
| Hallazgos reportados | 32 | 31 | 84 |
| Hallazgos por juez | 5,3 | 5,2 | 42 |
| Marcados por el consolidador como repetidos | 3 | 2 | |
| Repetidos, refutados o decididos tras mi lectura | 9 | 9 (cuenta aproximada) | 33 |
| Resto | 23 | 22 | 51 |
| De severidad 4 o 5 | 0 | 0 | 2 |

Los 51 de la ronda 3 son los que no son refutados ni reaparición; el libro los cerró con un arreglo. Los 23 y 22 de las mediciones nuevas no tienen arreglo todavía.

Cómo se contó: el consolidador marca por similitud de títulos y detectó 3 de los 9 que encontré leyendo el libro (33 %, la exhaustividad medida en `2026-10-21-umbral-de-repeticion-en-el-libro.md` es 35 %). Los 6 restantes se parecen en la idea y no en las palabras: «Desactivar» sin peso visual (H-340, H-534 y H-840 lo dejaron callado a propósito), «Reemplazar con .md» (H-348 y H-529), Transcripción sin selector (H-345, un solo proveedor), el 9 de la campana repetido en Mensajes (UD-028 pide ambos y UD-036 lo deja así), «Telemetría de uso» sin texto de ayuda (la regla de interfaz es no llevarla por omisión) y el chip «+1» y los selectores apilados del teléfono (H-505, H-506).

De los 23 de la medición 1 abrí 12 capturas y los confirmé: el aviso que tapa el encabezado de Envíos, «Ver más» en las siete filas de Equipo, el botón «Miembro» que repite la columna y las insignias, «Campos e instrucciones» junto a «Instrucciones al modelo», el texto de la tarjeta de Inicio que deja libre el ancho bajo la miniatura, el tipo de respuesta «Resuelto», la «×» pegada a cada destinatario, la vista previa de Proyecto cortada, entre otros. Los otros 11 no los verifiqué: quedan como candidatos con su captura citada.

## Qué cambió entre la medición 1 y la 2

La medición 1 mostró dos fallas del método, corregidas antes de la 2:

- Las decisiones sobre la campana y la barra lateral no llegaban a los encargos de las pantallas que no las nombran, aunque la campana está en todas. Ahora rigen en todos los encargos.
- Algunos jueces abrieron la mitad de las capturas. El encargo pide ahora abrirlas todas; en la medición 2 cinco de los seis declararon haber abierto todas.

Esos cambios no bajaron la proporción de repetidos: los que quedan son la misma idea con otras palabras, y sólo se evitan diciéndole al juez qué se resolvió, que es lo que el dueño no quiere (UD-062). El consolidador los marca, no los evita.

## Límites

- No hay verdad de terreno de los hallazgos que un juez único habría encontrado y estos no: ningún hallazgo de severidad 4 o 5 apareció, y no se sabe si falta uno. Cada juez acotado usó menos de un minuto de los cinco que tiene.
- La telemetría de los encargos es la de una pasada sintética por el servidor de ejemplo, no de uso de personas.
- Los jueces eran seis subagentes del mismo modelo y proveedor; no se midió el acuerdo entre dos corridas del mismo encargo.
- Los tiempos del método anterior son la cifra del dueño, no una medición propia de esta sesión.

## Ejemplo del informe de telemetría

Salida de `node scripts/ui-report.mjs` (el mismo texto que `renderReport`) sobre la pasada sintética de capturas de los flujos de envío, respuesta y cierre, en el servidor de ejemplo. No son datos de personas: sirven para ver la forma. Las dos ventanas son los 390 px y los 1440 px de la pasada.

```
Telemetría de interfaz, del 2026-10-14 16:22 al 2026-10-21 16:22 (UTC)
16 sesiones, 75 eventos

Tareas (duración y esfuerzo de las completadas; percentiles p50, p75, p95)
Tarea              Inicios  Completas  Abandono  Falla  Duración p50     p95  Clics p50  p95  Desplazamientos p50  p95
-----------------  -------  ---------  --------  -----  ------------  ------  ---------  ---  -------------------  ---
Enviar y publicar        2          2     0.0 %  0.0 %        1.32 s  1.78 s          3    3                    2    2
Responder                1          1     0.0 %  0.0 %        0.03 s  0.03 s          1    1                    0    0
Cerrar                   1          1     0.0 %  0.0 %        0.02 s  0.02 s          1    1                    0    0

Etapas del envío (tramo propio de cada una)
Etapa                                   Medidas     p50     p75     p95
--------------------------------------  -------  ------  ------  ------
Clic en Enviar a primer cambio visible        2  0.04 s  0.12 s  0.12 s
Primer cambio a análisis visible              2  0.10 s  0.20 s  0.20 s
Análisis visible a publicado                  2  1.09 s  1.56 s  1.56 s

Pantallas
Pantalla  Visitas  Pintado p75  Estancia p50  Clics/visita p50  Teclado  Errores/100      CLS p75      INP p75       LCP p75
--------  -------  -----------  ------------  ----------------  -------  -----------  -----------  -----------  ------------
Inicio         13        41 ms        0.02 s                 0    0.0 %            0      0 bueno  96 ms bueno  212 ms bueno
Mensaje         2        55 ms        1.87 s                 0    0.0 %            0  0.056 bueno  48 ms bueno  164 ms bueno

Errores: 0 (0 por cada 100 navegaciones)

Entrada: teclado 0.0 % (0 teclas contra 8 punteros)

Ventanas (ancho, visitas)
Ancho      Visitas
---------  -------
<640            14
640-767          0
768-1023         0
1024-1279        0
1280-1535       14
>=1536           0

Peores recorridos por clics hasta completar (4)
Tarea              Clics  Desplazamientos  Teclas  Pantallas  Duración      Cuándo (UTC)    Sesión
-----------------  -----  ---------------  ------  ---------  --------  ----------------  --------
Enviar y publicar      3                2       0          1    1.78 s  2026-10-21 16:21  ad7086e4
Enviar y publicar      3                2       0          1    1.32 s  2026-10-21 16:21  9bd95eee
Responder              1                0       0          1    0.03 s  2026-10-21 16:21  b558d910
Cerrar                 1                0       0          1    0.02 s  2026-10-21 16:21  b558d910
```
