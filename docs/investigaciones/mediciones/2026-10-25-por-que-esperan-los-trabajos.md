# Por qué esperan los trabajos execute

Fecha: 2026-10-25, 13:44 (hora de Chile). Pedido de Martín: saber por qué dos de los seis mensajes del 13:32 (#118 y #122) no empezaron. Medido en producción, sólo lectura: `/data/team.db` del contenedor `devalis-team-platform` y `env` del contenedor `devalis-team-platform-worker`.

Resultado:

| Dato | Valor |
|---|---|
| Trabajos `execute` del lote | 165, 166, 167 y 169 en `running`; 164 (#118) y 168 (#122) en `queued` con `run_at` movido cada 30 s |
| Paso que publicaron 164 y 168 en `job_events` | `budgetWait` (no `capacityWait`) |
| `EXECUTE_MAX_MACHINES` | 6, con 4 máquinas vivas: no es el tope que retiene |
| `QUEUE_CONCURRENCY` | 12 (hasta 10 sesiones a la vez): no es el tope que retiene |
| `EXECUTE_DAILY_BUDGET_USD` | 40 |
| `EXECUTE_MAX_BUDGET_USD` | sin declarar: vale 10 (valor por omisión de UD-255) |
| Gasto del día (9 trabajos terminados) | 3,76 USD |
| Reserva de las sesiones en curso | 10 + 10 + 10 + 6,24 = 36,24 USD, todo el saldo del día (40 − 3,76) |

Causa: cada sesión que empieza reserva `mín(EXECUTE_MAX_BUDGET_USD, saldo − reservas)` (UD-256). Tres sesiones reservaron 10 USD y la cuarta el resto, 6,24 USD; con `available < 0,01` el quinto trabajo se difiere con `budgetWait` y vuelve a mirar cada `EXECUTE_CAPACITY_WAIT_MS` (30 s). Esperan hasta que una sesión termine y libere su reserva.

De dónde sale cada número: el 40 lo fijó la configuración de producción; el 10 por sesión es el valor por omisión de UD-255 («10 USD por mensaje para empezar»), un número elegido. Lo medido: los últimos trabajos terminados costaron entre 0,48 y 1,87 USD (trabajos 155, 156, 158 y 161), de modo que cada reserva retiene entre 5 y 20 veces lo que la sesión gasta. Con 40 USD de tope y reservas de 10 caben cuatro sesiones a la vez aunque `EXECUTE_MAX_MACHINES` y `QUEUE_CONCURRENCY` admitan seis y diez. Un trabajo que sale del tope diario real (saldo ≤ 0) es otro caso, ya cubierto por una respuesta propia en el hilo.

El log del trabajador decía `job deferred: [object Object]` porque imprimía el objeto del paso, no su texto. Desde UD-303 imprime el texto del paso y, como datos, `defer_code` y `reason` (`code`, tope diario, gastado, reservado y sesiones).
