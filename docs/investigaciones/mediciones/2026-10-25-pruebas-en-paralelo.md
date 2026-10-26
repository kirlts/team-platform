# Pruebas de navegador, contrato y vitest en paralelo

Fecha: 2026-10-25. Pedido: «optimizar drásticamente todo lo de las pruebas, todo lo de los tiempos».

## Condiciones

Cuatro núcleos (`taskset -c 0-3`) en una máquina compartida con carga de 5 a 16 durante las corridas. El reloj de pared se mueve con esa carga. El tiempo de CPU (usuario más sistema) no, y es la cifra que se compara entre corridas. Comando de cada fila al final.

## Antes y después

| Pieza | Antes | Después |
|---|---|---|
| Batería de navegador del panel (468 pruebas, 59 archivos) | 703 s de pared, 238 s de CPU, 1 falla | 218 s de pared, 192 s de CPU, 0 fallas |
| `npm run e2e:contrato` (166 pruebas) | 121 s de pared, 54 s de CPU, un proceso | 41 s de pared, 63 s de CPU, 4 procesos |
| vitest del panel (259 pruebas) | 15,4 s de pared, 39 s de CPU | 4,1 s de pared, 10,5 s de CPU |
| `flows-avisos` | 37 a 63 s | 8 s |
| `flows-ronda3b` | 43 s | 22 s |
| `fits-one-screen` | 227 s en un archivo | 45 s la parte más lenta, en 5 procesos |

## Por qué tardaba

`test:flows` y `test:fit` corrían `node --test --test-concurrency=1`: los 59 archivos uno tras otro, 967 s de suma de archivos medidos con tres a la vez. Los archivos no comparten estado: cada uno levanta su servidor de ejemplo y su Chromium. Varios compartían puerto fijo (8742, 8806 y 8967 se repetían), y eso obligaba a la serie. `fits-one-screen` sola eran 227 s: 4 tamaños de ventana en serie, con dos esperas de 5 s de reloj por tamaño.

El arranque de Chromium cuesta 50 ms y el del servidor de ejemplo 200 ms por archivo; compartirlos entre archivos no se justifica. El gasto está en las cargas de página de cada prueba.

## Qué cambió

- `panel/scripts/browser-tests.mjs`: un solo build del panel para toda la corrida (`PANEL_DEV_DIST`), un pool de procesos del ancho que dan los núcleos (`availableParallelism`, dos tercios más uno; `PANEL_BROWSER_JOBS` lo cambia). Los archivos más grandes van primero. Con 8 procesos en 4 núcleos aparecieron tiempos agotados (carga sobre 20), por eso el ancho no se sube. Los scripts `test:flows`, `test:fit`, `test:gallery`, `test:overflow`, `test:sidebar` y `test:telemetry` llaman al pool; `test:browser` corre todos.
- `startPanel` pide puerto 0 al sistema y lee el que salió de la línea del servidor; `fixedPort` o `PANEL_FIXED_PORTS=1` fijan uno. Sin puertos repetidos no hay choques entre archivos en paralelo.
- `fits-one-screen` se parte en un proceso por tamaño de ventana y uno para la ventana que crece (`FIT_SHARD`, `panel/src/fit-shards.mjs`). Sin la variable corre entera.
- `login` abre la sesión por la API del contexto y la página carga una vez. El formulario sigue en `login-support` (`{ form: true }`). CPU de la batería de 247 s a 201 s.
- Esperas fijas a eventos. `flows-avisos` adelanta el reloj de la página (`page.clock.runFor`) en lugar de esperar 5, 8, 6,5 y 8,8 s, y ya no depende de la carga: era la falla de la corrida anterior.
- `flows-ronda5-listas` esperaba 400 ms y ahora espera la primera fila de la página siguiente.
- M8 leía la API justo después de enviar y ahora espera el POST de la respuesta.
- `flows-ronda3b` pedía 450 ms por paso del análisis simulado; con 80 ms, el valor de los demás archivos, pasa en tres corridas. Bajar todos a 10 ms rompía una prueba en `flows` y otra en `flows-ronda3a`, que miran estados intermedios; no se tocó.
- `e2e/contrato/run.mjs` reparte los archivos entre tantos procesos como núcleos (`E2E_SHARDS`, `--serial` para uno), cada uno con su servidor y su Chromium, los archivos más grandes primero. Con fragmentos de nombre sigue siendo un proceso.
- vitest del panel con `pool: 'vmThreads'`: jsdom se creaba 47 veces y era el 52% del tiempo.
- `scripts/test-dirigido.mjs`: los archivos de navegador van al pool. Un cambio solo en una página (`panel/src/pages/<Página>.tsx`) corre las pruebas que abren su ruta; cualquier otro cambio en `panel/` corre todas, y también vitest. Los demás archivos corren con un proceso por núcleo.

## Una prueba por garantía

Dos pruebas contra el servidor de ejemplo repetían una garantía que el contrato ya prueba contra el servidor real. Se quitaron y quedó la del contrato:

| Garantía | Prueba que queda | Prueba retirada |
|---|---|---|
| Los modelos de un área son del Editor: el Editor ve los dos selectores, un miembro no llega a ellos, la API responde 403 y no guarda | `e2e/contrato/A2-modelos-solo-editor.e2e.test.mjs` | `flows-plantillas-area`, «the models of an area are the Editor's» |
| Un reenvío sin motivo se rechaza con 400 | `e2e/contrato/M4-reenviar-con-comentario.e2e.test.mjs`, que ahora también exige el código `forward_comment_required` | `flows-reenviar`, «an empty reason is refused by the server» |

Las demás parejas (A1 con `flows-plantillas-area`, M2 con `flows-destinatarios`, M4 con `flows-reenviar`, M7 con `flows-menciones`) comprueban cosas distintas. El contrato usa el servidor real a 1440 y 1920 px. Las de navegador miden teléfono, teclado y estados intermedios. Quedan las dos.

## Comandos

```
cd panel && taskset -c 0-3 node scripts/browser-tests.mjs          # después; antes: node --test --test-concurrency=1 src/*.browser.test.mjs
taskset -c 0-3 node e2e/contrato/run.mjs --serial                  # antes del contrato
E2E_SHARDS=4 taskset -c 0-3 node e2e/contrato/run.mjs              # después
cd panel && npx vitest run                                          # antes con pool por omisión
```
