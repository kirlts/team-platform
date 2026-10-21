# Una corrida real del harness, 2026-10-21

Resultado: `ANALYZER=harness` con `claude` 2.1.284 y la suscripción del dueño analizó `01-chat-grupo` en 36,9 s, con cobertura 100 %, clasificación 100 % y MECE 1 de 1. El validador aceptó la propuesta al primer intento (0 reintentos). La misma configuración con `api` tarda 4,4 s en este caso (`2026-10-20-primera-corrida-real.md`, columna Final).

## Comando

```sh
ANALYZER=harness node bench/run.mjs --analyzer harness --case 01-chat-grupo --out <archivo>.json
```

Una sola corrida, sin repetición, el 2026-10-21 a las 22:00 UTC. Presupuesto de API: 0, porque el harness usa el inicio de sesión de la suscripción y no una llave.

## Medición

| Dato | Valor |
|---|---|
| Tiempo total | 36.894 ms |
| De ese tiempo, el modelo (`duration_ms` de `claude -p`) | 23.919 ms |
| Preparación del directorio y validación | 2 ms y menos de 1 ms |
| Llamadas a `claude -p` | 1 |
| Turnos internos | 6 |
| Modelos que respondieron | `claude-haiku-4-5-20251001` y `claude-opus-5-5` |
| Tokens de entrada, salida y de caché leídos | 6, 2.134 y 70.232 |
| Tokens escritos en caché | 42.922 |
| `total_cost_usd` informado | 0,4018 USD (valor equivalente a tarifa de API; la suscripción no lo cobra por separado) |
| Mensajes | 3 de 3 esperados, 0 repetidos, 0 partidos, 0 fusionados, 0 sobrantes |
| Área y plantilla acertadas | 13 de 13 unidades |
| Reintentos por salida inválida | 0 |
| Marcas de IA por mensaje | 0,00 |

## Lectura

- 13,0 s de los 36,9 s no son tiempo de modelo. Entre lectura y escritura de caché se mueven 113.154 tokens para un chat de 17 unidades. Es el contexto de sistema que MASTER-SPEC §3 anticipaba (27 a 31 mil tokens por trabajo, sin `--bare`).
- Con `api`, el mismo caso baja a 4,4 s porque la clasificación y la descomposición son llamadas cortas, sin ese contexto.
- Una corrida no mide estabilidad. La repetibilidad del harness entre corridas no está medida.
