# PDF, enlaces, HEIC y flujo SSE con archivos y servidores reales

Fecha de consulta: 2026-10-21. Cierra H-21, H-22, H-57 y H-66. Equipo: el de desarrollo (Linux, Node 24, Docker). Sin llamadas a proveedores de modelo: costo de API 0 USD.

## PDF reales (H-22)

Descargados el 2026-10-21 y leídos con `extract` (sin proveedor de visión: la llamada habría fallado la prueba).

| Archivo | Tamaño | Páginas | Texto | Tiempo | Memoria del proceso |
|---|---|---|---|---|---|
| `arxiv.org/pdf/1706.03762` (artículo de 15 páginas) | 2,1 MiB | 15 | 39.817 caracteres, `scanned: false` | 1,7 s | 180 MB |
| `rfc-editor.org/rfc/rfc9110.pdf` (especificación) | 2,7 MiB | 194 | 464.565 caracteres, cortado a 270.000 con el aviso `text_truncated` | 1,4 s | 178 MB |

## Páginas reales descargadas de internet (H-22)

| Dirección | Respuesta | Texto | Tiempo |
|---|---|---|---|
| `rfc-editor.org/rfc/rfc9110.html` | 200, 1,1 MiB | 269.940 caracteres, `truncated: true` | 2,9 s |
| `en.wikipedia.org/wiki/Server-sent_events` | 200, 115 KiB | 6.580 caracteres | 0,4 s |
| `arxiv.org/abs/1706.03762` | 200, 43 KiB | 2.428 caracteres | 0,2 s |

La prueba `src/extract/real-world.live.test.js` repite el artículo y la página de Wikipedia con `TEAM_LIVE_NETWORK=1` y se omite sin esa variable.

## HEIC (H-21)

Tres archivos HEIC de teléfono, de 1,1 a 3 MB (`github.com/tigranbs/test-heic-images`, descargados el 2026-10-21), y uno de 1,2 KB escrito con libheif. Los cuatro tienen la marca `heic` y carga HEVC.

- `sharp` lee los metadatos (`heif`, 3992 por 2992) y falla al decodificar: «Support for this compression format has not been built in: HEVC». El decodificador de la imagen no puede leer un HEIC real; rechazarlo por su marca es lo correcto.
- Antes: el archivo se aceptaba en la subida y fallaba al extraer, después de encolar. Ahora la subida lo rechaza con 422 `image_heic_unsupported`. Juzga por la marca del contenedor, no por el nombre ni por el tipo declarado (`src/size-limits.test.js`). El panel muestra la causa en su idioma.
- Fixture versionada: `src/extract/test/fixtures/libheif.heic`, escrita por el autor, 1.188 bytes.
- Límite: cuál formato envía Safari de iOS desde el selector de archivos no se pudo comprobar sin un iPhone; entra en H-56.

## Flujo SSE detrás de proxies (H-57)

`scripts/check-sse.mjs` inicia sesión, abre `/api/events` y mide cuándo llegan el primer byte y el primer latido (15 s). Pasa si el primer byte llega en menos de 2 s y el latido en menos de 20 s.

| Camino | Primer byte | Primer latido | Resultado |
|---|---|---|---|
| Directo al servidor | 6 ms | 15,0 s | pasa |
| nginx 1.29 con `proxy_buffering` por omisión | 7 ms | 15,0 s | pasa |
| nginx 1.29 con `proxy_ignore_headers X-Accel-Buffering` | 4 ms | 15,0 s | pasa |
| Caddy 2 con TLS interno delante del contenedor de `compose.yml` | 13 ms | 15,0 s | pasa |
| `tailscale serve` del VPS, por la tailnet | 76 ms | 15,1 s | pasa |

La respuesta lleva `x-accel-buffering: no`; una prueba lo exige (`src/events/events.test.js`).

## Formas de instalación (H-66)

- Forma 1 (compose más proxy con TLS): `scripts/install.sh --no-start` creó el `.env` y `docker compose up -d --no-build --wait` levantó el servicio. Caddy 2 con TLS interno lo sirvió en `https://localhost:8443`, `/health` respondió y el flujo SSE pasó. La imagen se construyó antes; no se probó la emisión del certificado de Let's Encrypt, que necesita un dominio propio.
- Forma 2 (dentro del compose de otro proyecto): con `compose.override.example.yml` sobre un proyecto de prueba, el servicio quedó sano, `docker compose exec web wget -qO- http://team-platform:3000/health` devolvió `ok` y `docker port` no mostró ningún puerto publicado.
- Forma 3 (`tailscale serve`): corre en el VPS del autor (H-89) y es la que respondió a `check-sse.mjs` arriba.
