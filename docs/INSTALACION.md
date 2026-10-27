# Instalación

Requisitos: Docker 25 o superior con el plugin `compose` (el `HEALTHCHECK` usa `--start-interval`, desde Docker 25). La imagen ocupa 306 MB: Alpine con un `ffmpeg` mínimo compilado en la propia imagen (LGPL, 22 decodificadores), Node y 62 MB de dependencias de producción podadas (detalle en `docs/investigaciones/mediciones/2026-10-20-imagen-docker.md`). La base y los adjuntos viven en el volumen `/data`, que tiene que ser disco local. SQLite en modo WAL no funciona sobre sistemas de archivos de red.

La aplicación escucha en el puerto 3000 del contenedor. `compose.yml` lo publica sólo en `127.0.0.1`. El acceso desde fuera del servidor lo da un proxy con TLS (formas 1 y 3) o la red del proyecto anfitrión (forma 2). La cookie de sesión es `__Host-` con `Secure`: sin HTTPS no inicia sesión, salvo en `localhost`.

## Variables

`scripts/install.sh` crea `.env` desde `.env.example` (modo 600) y pide lo mínimo.

| Variable | Uso |
|---|---|
| `ADMIN_EMAIL` | Correo del primer Editor |
| `ANTHROPIC_API_KEY` | Texto, visión y PDF |
| `SECRETS_KEY` | Clave maestra de las claves guardadas desde Configuración (64 hex). Sin ella se crea `secrets.key` en el volumen de datos. Respaldarla junto con la base |
| `GROQ_API_KEY` | Transcripción de audio y video. Sin ella no se transcribe |
| `DEEPSEEK_API_KEY` | Proveedor de respaldo, opcional |
| `PUBLISH_PORT` | Puerto en el anfitrión. Vacío usa 3000 |

## Lo que `scripts/install.sh` deja además

- **Gancho de pre-commit.** Corre `git config core.hooksPath .githooks` en el clon que instala (también con `--no-start`). Git no activa solo un directorio de ganchos versionado: sin ese ajuste, `.githooks/pre-commit`, que escanea las credenciales de lo que se va a commitear, no corre (DT-004). En un clon donde no se usa `install.sh` el comando es el mismo.
- **Lista de contraseñas bloqueadas.** Baja a `$DATA_DIR/password-blocklist.txt` del volumen (`/data` en el contenedor) las contraseñas más comunes, si el archivo no está. La aplicación lo usa sola cuando `PASSWORD_BLOCKLIST_FILE` no está definida; con la variable, manda la variable.
  - Fuente: `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt` de [SecLists](https://github.com/danielmiessler/SecLists), de Daniel Miessler, licencia MIT (su `LICENSE`, leído el 2026-10-21). Fijado al commit `0c03d70db30ceedb941ac58b0ec910eb85906d6f` (consultado el 2026-10-20) y verificado por SHA-256 `424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51`. La licencia MIT es la del repositorio; el archivo de datos no trae una propia, y su origen es la publicación de 10 millones de contraseñas filtradas de Mark Burnett (2015). No se verificó una licencia aparte para esos datos.
  - Se guardan sólo las entradas de `PASSWORD_MIN_LENGTH` caracteres o más (15 por omisión): las más cortas ya las rechaza la validación de largo. Del archivo de 1.000.000 de entradas quedan 10.908. La lista de las 10.000 más comunes (`10k-most-common.txt`) tiene una sola entrada de 15 o más caracteres, así que no sirve con este mínimo. Si se baja el mínimo en `.env`, se borra el archivo del volumen y se corre `install.sh` otra vez.
  - Sin red, sin `curl` o con un contenido que no coincide con el SHA-256, el instalador avisa y sigue: el servicio funciona validando sólo el largo. Con `--no-start` no se toca el volumen; la lista se instala en la primera corrida sin esa opción.
  - `BLOCKLIST_URL` y `BLOCKLIST_SHA256` del entorno reemplazan la fuente (un espejo propio).

## La versión que se instala

`main` es lo que el canónico publicó, no una dirección estable: avanza cada vez que `scripts/publish-main.sh` pasa la batería y la conformidad sobre un commit de `desarrollo`. Una instalación fija la versión por una de estas tres referencias y no sigue `main`:

| Referencia | Cuándo | Ejemplo |
|---|---|---|
| Etiqueta `vX.Y.Z` | Lo normal: cada publicación de `main` lleva su etiqueta y una sección en `docs/CHANGELOG.md` | `git checkout v0.1.0` |
| Sha de commit | Un anfitrión que necesita un commit exacto, por ejemplo uno anterior a la etiqueta siguiente | `git checkout <sha>` |
| Digest de la imagen | Un anfitrión que construye la imagen una vez y despliega esa | `docker build -t team-platform:<sha> .` y se despliega el digest que `docker image inspect` informa |

Qué significa cada número: el patch trae correcciones y cambios que nadie tiene que atender al instalarlos; el minor trae una capacidad nueva o una variable nueva con omisión (el contrato de anfitrión sólo crece de forma aditiva); el major cambia `contract_version` o algo que rompe una instalación que funciona. El número sale de `package.json` `version` y sube con un commit a `desarrollo` que corre `node scripts/prepare-release.mjs <patch|minor|major|current>`, que además mueve lo de `[Unreleased]` en `docs/CHANGELOG.md` a la versión. Quien actualiza lee las líneas de `docs/CHANGELOG.md` entre su versión y la nueva, y corre la conformidad de su driver (siguiente sección de este documento) antes de cambiar la referencia.

### El registro de batería de un commit

Cada commit que pasó la batería completa del canónico deja un registro. Un anfitrión lo consulta antes de repetir en su imagen las pruebas del canónico. Son notas de git, una por sha, en dos referencias. Cada escritura es un commit de la referencia, así que una nota escrita a mano deja autor, fecha y padre en su historia. Sólo existen para lo que pasó: si una orden salió distinto de 0, no se escribe nada.

`refs/notes/verificaciones` es la que lee el anfitrión. Consulta con el sha completo, desde cualquier repositorio y sin clonar el canónico. Sale 0 e imprime el JSON si hay registro, y 1 si no lo hay:

```
git fetch -q https://github.com/kirlts/team-platform.git +refs/notes/verificaciones:refs/notes/verificaciones && git notes --ref=verificaciones show <sha completo>
```

La nota es un objeto JSON con estos campos, todos obligatorios:

| Campo | Valor |
|---|---|
| `formato` | `1` |
| `sha` | Los 40 caracteres del commit probado; el de la nota |
| `resultado` | `verde` |
| `anfitrion` | Huella del compose del anfitrión contra el que pasaron las pruebas: su texto con cada sha de 40 caracteres (y su sufijo `-<huella>`) reemplazado por `V`, SHA-256, primeros 16 caracteres |
| `imagen_base` | Digest de la imagen base que el anfitrión declara (`--base-image <ref>`). Sin esa opción, la base externa de la última etapa del `Dockerfile`. `sha256:` y 64 caracteres hexadecimales |
| `node` | Versión de Node con que corrieron las órdenes, como la imprime `node --version` (`v24.1.0`) |
| `comandos` | Lista no vacía de `{ "orden": "<comando corrido>", "codigo": <código de salida> }`, todos con código `0` |
| `momento` | Fecha y hora UTC, ISO 8601 |

La huella del anfitrión se entrega al escribir: `--compose <archivo>` la calcula del compose del anfitrión y `--anfitrion <16 hex>` la recibe hecha. Sin ninguna de las dos se escribe sólo el registro detallado. La imagen base la nombra el anfitrión con `--base-image <ref>` (por ejemplo `node:24-alpine`): el digest sale de `image_base` del registro detallado si la referencia es un `FROM` externo del `Dockerfile`, y si no, se consulta con `docker buildx imagetools inspect <ref>`. Si no se puede resolver el digest de la imagen base, no se escribe ninguno de los dos.

`refs/notes/battery` guarda el registro detallado, para auditar: `tree`, `date`, `node`, `runner`, `commands` (`cmd`, `exit`, `seconds`, `tests`, `pass`, `fail` y `log_sha256`, la huella de su salida completa), `skipped` (lo que la puerta no corrió y por qué) e `image_base` (referencia y digest de cada base externa del `Dockerfile`). Con el script del canónico se lee con `--ref battery`:

```
node scripts/battery-record.mjs show <sha> --remote https://github.com/kirlts/team-platform.git [--ref verificaciones|battery] [--trace]
```

El script acepta un prefijo del sha, comprueba que la nota corresponde al commit y funciona fuera de un repositorio. Sale 0 con el JSON, 1 sin registro y 3 con un registro que no vale. `--trace` imprime los commits de la referencia que tocaron la nota: quién la escribió y cuándo.

Una orden que falló y nombra sus archivos de prueba se repite una vez, sólo en esos archivos. Si pasan, el registro detallado la deja con `exit` 0 y lleva `first_run` y `retried`. La verificación nombra la orden con lo que se repitió, para que no diga que la primera corrida pasó.

Quién lo escribe: `scripts/publish-main.sh` lo deja al publicar `main`, con lo que su batería ya corrió (con `PUBLISH_HOST_COMPOSE` escribe también la verificación). `node scripts/battery-record.mjs run <sha> --compose <archivo> --base-image <ref>` lo genera para un commit que no se publicó. `PUBLISH_HOST_BASE_IMAGE` pasa la misma referencia a `scripts/publish-main.sh`. Sus órdenes son `test:completa`, `test:panel`, `test:client` y `node --test src/static.test.js`, una tras otra: la primera levanta contenedores y las demás abren puertos.

Cuando el anfitrión endurece el formato de la verificación, las ya publicadas se reescriben sin repetir la batería:

```
node scripts/battery-record.mjs regenerate <sha> --compose <archivo> --base-image <ref> [--dry-run]
```

Toma las órdenes, sus códigos, `first_run`/`retried`, `node` y los digests del registro detallado de ese sha en `refs/notes/battery`, y reescribe sólo `refs/notes/verificaciones` con el mismo empuje sin forzar. No escribe nada si el registro detallado no existe o si una orden no salió 0. `--dry-run` imprime la verificación y no empuja.

## 1. Sola en un VPS

Servidor con Debian o Ubuntu, un dominio con registro A hacia su IP.

```sh
curl -fsSL https://get.docker.com | sh
git clone <URL-DEL-REPOSITORIO> /opt/team-platform
cd /opt/team-platform
scripts/install.sh
```

El servicio queda en `127.0.0.1:3000`. TLS con Caddy en el anfitrión:

```sh
apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<'EOF'
team.ejemplo.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy
```

Si el servidor tiene cortafuegos, se abren 80 y 443:

```sh
ufw allow 80,443/tcp
```

Comprobación:

```sh
curl -fsS https://team.ejemplo.com/health
TEAM_EMAIL=… TEAM_PASSWORD=… node scripts/check-sse.mjs https://team.ejemplo.com
```

La segunda línea abre el flujo de eventos y falla si el proxy retiene el primer byte o el latido de 15 s. Con nginx basta el encabezado `X-Accel-Buffering: no`, que el servidor ya envía.

## 2. Dentro del compose de otro proyecto

El servicio entra a la red por omisión del proyecto y no publica puertos. Los demás servicios lo alcanzan en `http://team-platform:3000`. Para servirlo bajo el mismo origen del sitio, el proxy del proyecto le reenvía una ruta o un subdominio.

```sh
git clone <URL-DEL-REPOSITORIO> /opt/team-platform
docker build -t team-platform:local /opt/team-platform
cp /opt/team-platform/.env.example team-platform.env
```

Se completa `team-platform.env` junto al `compose.yml` del proyecto, y se levanta con los dos archivos:

```sh
docker compose -f compose.yml -f /opt/team-platform/compose.override.example.yml up -d
```

Las rutas relativas del override se resuelven desde la carpeta del primer `-f`. Para no repetir los flags, se fija `COMPOSE_FILE`:

```sh
export COMPOSE_FILE=compose.yml:/opt/team-platform/compose.override.example.yml
```

Comprobación desde otro servicio del proyecto:

```sh
docker compose exec <servicio> wget -qO- http://team-platform:3000/health
```

## 3. Detrás de `tailscale serve`

Sólo la tailnet alcanza el servicio. Requiere MagicDNS y HTTPS activados en la página DNS de la consola de Tailscale (Tailscale, 2026-10-20).

```sh
git clone <URL-DEL-REPOSITORIO> /opt/team-platform
cd /opt/team-platform
scripts/install.sh
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale serve --bg --https=443 localhost:3000
```

Estado y retiro:

```sh
tailscale serve status
tailscale serve reset
```

La dirección es `https://<máquina>.<tailnet>.ts.net`. Con `compose.yml` el puerto 3000 sólo escucha en loopback, de modo que `tailscale serve` es la única entrada.

## Analizador `harness` en el contenedor

`ANALYZER=harness` hace que cada análisis corra `claude -p` con la suscripción de Claude Code en vez de llamar a la API (UD-008, MASTER-SPEC §7.5). La imagen no trae `claude`. Se agrega con una imagen derivada, y la credencial se pasa por el entorno del contenedor.

Imagen derivada. `claude.exe` es el ejecutable que instala el paquete `@anthropic-ai/claude-code`; la variante `linux-x64-musl` (o `linux-arm64-musl`) corre sobre la base Alpine. Se fija la versión probada:

```sh
cat > Dockerfile.harness <<'EOF'
FROM node:24-alpine AS claude
RUN npm install -g @anthropic-ai/claude-code@2.1.284
FROM team-platform:local
USER root
RUN apk add --no-cache libgcc ripgrep
COPY --from=claude /usr/local/lib/node_modules/@anthropic-ai /usr/local/lib/node_modules/@anthropic-ai
RUN ln -s /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude
USER node
EOF
docker build -t team-platform:harness -f Dockerfile.harness .
echo 'IMAGE_TAG=team-platform:harness' >> .env
```

Credencial. En una máquina con sesión de Claude Code, `claude setup-token` imprime un token de larga duración de la suscripción. Va en `.env` (modo 600, fuera de git y fuera de la imagen), que `compose.yml` pasa al contenedor con `env_file`:

```sh
printf 'ANALYZER=harness\nCLAUDE_CODE_OAUTH_TOKEN=<token>\n' >> .env
docker compose up -d --wait
docker compose exec team-platform claude auth status
```

`--bare` no lee la suscripción, por eso el harness corre sin esa opción (MASTER-SPEC §7.5). El token no se escribe en `compose.yml`, en un `Dockerfile` ni en el repositorio; el escáner de `.githooks/pre-commit` revisa lo que se commitea. Para revocarlo se corta la sesión en la cuenta de Claude y se cambia el valor de `.env`.

Cuándo conviene:

| Situación | Analizador |
|---|---|
| Sin presupuesto de API y con una suscripción de Claude Code que el equipo ya paga | `harness` |
| Cada análisis debe terminar en segundos, o hay varios a la vez | `api` |
| Hay que medir costo por análisis o usar un proveedor de respaldo | `api` |

Medido el 2026-10-21 con una corrida de `01-chat-grupo`: 36,9 s con `harness` contra 4,4 s con `api`, con la misma cobertura y clasificación (`docs/investigaciones/mediciones/2026-10-21-harness-real.md`). El ejecutable de `claude` 2.1.284 sobre Alpine 3.24 se comprobó con `claude --version`. La imagen derivada completa sobre `team-platform:local` y el token de `setup-token` no se probaron: la medición usó el inicio de sesión de la máquina de desarrollo.

## Operación

Registros y estado:

```sh
docker compose logs -f
docker compose ps
```

Actualizar, con respaldo previo, a la versión que se decide (etiqueta, sha o digest; ver «La versión que se instala»):

```sh
scripts/backup.sh
git fetch --tags && git checkout v0.1.0
docker compose up -d --build
```

Apagar y volver a encender conserva los datos. `docker compose down -v` borra el volumen.

## Vaciar los datos de prueba

Dos alcances. `content` borra envíos, adjuntos, trabajos, propuestas, mensajes, respuestas y telemetría. También borra los archivos del volumen que quedan sin referencia. Conserva miembros, áreas, plantillas, ajustes y claves de proveedor. `everything` además elimina a todos los miembros salvo el Editor que se conserva y devuelve áreas y plantillas al juego inicial de `templates/`. La bitácora (`GET /api/audit`) se conserva y suma una fila `data.reset` con las cifras.

Desde el panel: Configuración, sección Datos, sólo para el Editor. Desde la línea de comandos, en el contenedor del VPS:

```sh
docker compose exec team-platform node scripts/vaciar.mjs --scope content
docker compose exec team-platform node scripts/vaciar.mjs --scope content --si
docker compose exec team-platform node scripts/vaciar.mjs --scope everything --conservar <correo del Editor> --si
```

Sin `--si` imprime las cifras y no borra. El guion trabaja directo sobre la base (`DATA_DIR` o `.env`), con el servicio en marcha o detenido. Por la API: `POST /api/ops/reset?confirm=true` con cuerpo `{ "scope": "content" }`.

## Sembrar un juego de prueba

Desde la pantalla: Configuración, Datos, «Sembrar ejemplos» (sólo el Editor). Envía los siete envíos de `ejemplos/` a nombre de quien pide, por `POST /api/ops/seed?confirm=true`, y muestra «N envíos»; el avance sale por la bandeja de Inicio. Costo real del juego completo: 0,01 USD con Claude Haiku 5.5. La imagen de Docker lleva `ejemplos/`.

Por línea de comandos:

`scripts/sembrar.mjs` envía archivos por la API de un servidor en marcha, de modo que cada envío pasa por el análisis real. Cada archivo suelto es un envío: `.md` y `.txt` como texto, imágenes, audio, video, `.pdf` y `.docx` como adjuntos. Una subcarpeta es un solo envío con todos sus archivos. Al final imprime una tabla: envío, estado, mensajes publicados, segundos.

```sh
node scripts/sembrar.mjs --url https://team.ejemplo.com --email <correo> --password <clave> --ejemplo
node scripts/sembrar.mjs --url https://team.ejemplo.com --email <correo> --password <clave> --carpeta ./mis-archivos --paralelo 3 --limite 10
```

`--ejemplo` siembra los siete envíos de `ejemplos/` del repositorio. `--paralelo N` fija cuántos envíos corren a la vez (3 por omisión; con 1 corren uno por uno, para distinguir una falla de una competencia). `--token <cookie>` reemplaza al correo y la clave. `--borrador` deja las propuestas en revisión en vez de publicarlas. Medido el 2026-10-21 contra un servidor local con Claude Haiku 5.5 y `--paralelo 3`: los siete envíos de `ejemplos/` tardan de 4 a 8 s cada uno. Producen 14 mensajes y cuestan 0,0106 USD.

## Respaldo

`scripts/backup.sh` copia la base en caliente con `VACUUM INTO` y `rename`, la comprueba con `integrity_check` y la deja en `./backups/team-<fecha UTC>.db`. Con un escritor activo tarda 123 ms (informe 03, 2026-10-20). `cp` sobre la base en uso puede dejar una copia inconsistente.

```sh
scripts/backup.sh
WITH_FILES=1 DEST=/var/backups/team scripts/backup.sh
```

`WITH_FILES=1` agrega un `tar` con los adjuntos y las plantillas editadas. Respaldo nocturno, con `crontab -e`:

```
0 3 * * * cd /opt/team-platform && scripts/backup.sh
```

Restaurar una copia, con el servicio detenido. La base y los adjuntos se restauran por separado: la base nombra archivos que sólo existen en el `tar`, y sin él los adjuntos devuelven error.

```sh
docker compose stop
docker compose run --rm --no-deps -v "$PWD/backups:/restore:ro" --entrypoint sh team-platform \
  -c 'rm -f /data/team.db-wal /data/team.db-shm && cp /restore/team-<fecha>.db /data/team.db'
docker compose run --rm --no-deps -T -v "$PWD/backups:/restore:ro" --entrypoint sh team-platform \
  -c 'cd /data && tar -xf /restore/files-<fecha>.tar'
docker compose start
```

La segunda orden sólo hace falta si el respaldo se hizo con `WITH_FILES=1`. Los miembros y las contraseñas vienen en la base: tras restaurar, entran las cuentas del servicio de origen, no `ADMIN_EMAIL`. El respaldo queda con modo 600 en una carpeta 700 porque guarda las claves con hash y los adjuntos.

Medido el 2026-10-21 en el VPS de 2 núcleos, con una base de 19 MB y adjuntos de 82 MB. Respaldo con `WITH_FILES=1`: 1,8 s. Detener, restaurar la base y volver a estar sano: 5,1 s. Restaurar los adjuntos: 5,6 s.

## Bajo una ruta de otro sitio

El panel y la API se sirven bajo una ruta, por ejemplo `/team/`, de un sitio que ya existe. El proxy reenvía la ruta sin quitarle el prefijo, y la instancia sabe dónde vive:

```sh
BASE_PATH=/team/
API_PREFIX=/team/api
SSO_RETURN_PATH=/team/        # sólo con DELEGATED_MODE=sso-redirect
```

El servidor escribe la base y el prefijo en el `index.html` que entrega. La misma imagen sirve cualquier ruta sin recompilar. `/health` sigue en la raíz del servicio, y el contrato queda en `/team/api/openapi.json`.

Caddy:

```
sitio.ejemplo.com {
	handle /team/* {
		reverse_proxy 127.0.0.1:3000 {
			flush_interval -1
		}
	}
}
```

nginx:

```nginx
location /team/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

`proxy_pass` va sin ruta al final: con una ruta, nginx reemplaza el prefijo y la instancia recibe `/api` en vez de `/team/api`. `proxy_buffering off` y `flush_interval -1` dejan pasar el flujo de eventos sin retenerlo.

Dos instancias en un mismo host, `/team-a/` y `/team-b/`, llevan cada una su `BASE_PATH`, su `API_PREFIX`, su puerto (`PUBLISH_PORT`) y su carpeta, como en «Segunda instancia en el mismo servidor». Cada una necesita además una cookie de sesión con nombre propio, para que el inicio de sesión de una no reemplace al de la otra.

Si el anfitrión lleva el panel en un iframe o lo llama desde otro origen:

```sh
FRAME_ANCESTORS=https://consola.ejemplo.com
CSP_CONNECT_SRC=https://api.ejemplo.com
```

Sin esas variables, la CSP es la de siempre: `connect-src 'self'` y `frame-ancestors 'none'`.

El color, la tipografía y el radio se cambian sin recompilar con un archivo `.css` del anfitrión. `THEME_CSS=/ruta/tema.css` lo nombra; en Docker, la ruta es de un volumen montado. El servidor lo entrega como `/team/theme.css`, después de la hoja del panel, y lo relee en cada petición. Las fuentes e imágenes que estén en la misma carpeta (`.woff2`, `.woff`, `.ttf`, `.png`, `.svg`, `.webp`) se sirven bajo `/team/theme/<archivo>`; la hoja las nombra con `url(theme/<archivo>)`, porque la CSP sólo admite fuentes del mismo origen. Las variables que acepta están en MASTER-SPEC §7.8, «Contrato del tema».

```css
:root[data-theme='light'], :root[data-theme='dark'] { --color-accent: #0a7d55; }
:root { --radius-md: 4px; }
```

Comprobación:

```sh
curl -fsS https://sitio.ejemplo.com/team/api/health
curl -fsS https://sitio.ejemplo.com/team/ | grep team-base-path
```

## Segunda instancia en el mismo servidor

Sirve para ensayar una restauración o una configuración sin tocar el servicio real. Cada instancia necesita su carpeta, su puerto y su etiqueta de imagen. El nombre de la carpeta fija el proyecto de compose y, con él, el volumen y la red. Sin `IMAGE_TAG`, la construcción de la segunda mueve la etiqueta `team-platform:local` y el siguiente `docker compose up -d` de la primera la recrea con otro código.

```sh
git clone <URL-DEL-REPOSITORIO> ~/team-platform-ensayo
cd ~/team-platform-ensayo
ADMIN_EMAIL=ensayo@ejemplo.invalid PUBLISH_PORT=3300 scripts/install.sh --no-start
echo 'IMAGE_TAG=team-platform:ensayo' >> .env
scripts/install.sh
```

La contraseña del primer Editor se genera y aparece una vez en el registro: `docker compose logs team-platform | grep 'First editor'`. Con el respaldo restaurado, las cuentas son las del servicio de origen.

Retiro, sin tocar la instancia real:

```sh
cd ~/team-platform-ensayo
docker compose down -v
docker image rm team-platform:ensayo
cd .. && rm -rf team-platform-ensayo
```

Medido el 2026-10-21 en el VPS. Clonar: 5 s. `install.sh` con la caché de capas de la imagen: 29 s. Compilación desde cero con `ffmpeg`, sin caché y con `BUILD_JOBS=1`: 4 min 52 s. Servicio sano a los 10 s de levantarse.

## Identidad por cabecera detrás de `tailscale serve`

`IDENTITY_PROVIDER=delegated` con `DELEGATED_MODE=trusted-header` toma la identidad de la cabecera `Tailscale-User-Login` que `tailscale serve` agrega a cada petición de la tailnet. No hay pantalla de inicio de sesión ni cookie de sesión. El correo de la cabecera tiene que existir en `members` (UD-007): una cuenta que no está da 403 `member_not_registered`. El rol sale de la base.

Con Docker, `TRUSTED_PROXIES` no puede quedar en su valor por omisión (`127.0.0.0/8`). `tailscale serve` llega al puerto publicado en `127.0.0.1`. Docker lo reenvía desde la puerta de enlace de la red del proyecto, y la aplicación ve esa dirección (por ejemplo `172.28.0.1`). Descarta la cabecera y toda petición da 401. La dirección es la puerta de enlace de la red de la instancia.

```sh
GW=$(docker network inspect "$(docker compose ps -q team-platform | xargs docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')" --format '{{(index .IPAM.Config 0).Gateway}}')
printf 'IDENTITY_PROVIDER=delegated\nDELEGATED_MODE=trusted-header\nTRUSTED_PROXIES=%s\n' "$GW" >> .env
docker compose up -d --wait
sudo tailscale serve --bg --https=8445 localhost:3300
```

El último comando usa el puerto `PUBLISH_PORT` de la instancia y no activa Funnel. Comprobación desde un equipo de la tailnet:

```sh
curl -s https://<máquina>.<tailnet>.ts.net:8445/api/me
```

Responde el miembro dueño de la sesión de Tailscale, con `"provider":"delegated:trusted-header"`. Una cabecera `Tailscale-User-Login` puesta a mano por el cliente no cambia el resultado, porque `tailscale serve` la sobrescribe (comprobado el 2026-10-21).

Límites medidos:

- La puerta de enlace cambia si Docker recrea la red con otra subred (`docker compose down` y `up`). Si todas las peticiones vuelven a dar 401, se repite el primer comando.
- Cualquier proceso del servidor que llegue a `127.0.0.1:<puerto>` puede poner la cabecera y actuar como cualquier miembro (comprobado: `curl -H 'Tailscale-User-Login: <correo>' http://127.0.0.1:3300/api/me` da 200). Sólo es aceptable en un servidor donde nadie más tiene acceso a una sesión.
- El panel no dibuja `Cerrar sesión` en este modo: `/api/me` informa `delegated:trusted-header`, `/api/auth/logout` no existe (404) y la persona sigue dentro. Lo cierra Tailscale (UD-190).
- La defensa contra CSRF sigue activa: una petición con `Sec-Fetch-Site: cross-site` da 403.

## Dentro de un sitio con su propia sesión

El anfitrión firma un JWT RS256 por persona y Team Platform lo valida contra su JWKS. Con `IDENTITY_PROVISION=host` el miembro se da de alta en su primer ingreso, con el rol que trae el token. Ejemplo con el anfitrión en `ejemplo.cl` y Team Platform en `team.ejemplo.cl`.

1. El anfitrión publica su llave pública en `https://ejemplo.cl/.well-known/jwks.json` y emite, tras su propio inicio de sesión, un JWT con `iss`, `aud`, `exp`, `email`, `name` y `role` (`member` o `editor`). Un `role` distinto cuenta como no declarado.
2. El anfitrión entrega el token en una cookie de su dominio, por ejemplo `host_jwt` con `Domain=.ejemplo.cl; Secure; HttpOnly; SameSite=Lax`. La otra vía es la cabecera `Authorization: Bearer <jwt>` en cada petición a la API.
3. Variables de la instancia:

```sh
cat >> .env <<'EOF2'
IDENTITY_PROVIDER=jwt,signed-header
IDENTITY_PROVISION=host
JWT_JWKS_URL=https://ejemplo.cl/.well-known/jwks.json
JWT_ISSUER=https://ejemplo.cl
JWT_AUDIENCE=team-platform
JWT_COOKIE_NAME=host_jwt
COOKIE_DOMAIN=.ejemplo.cl
LOGOUT_URL=https://ejemplo.cl/salir
HOST_LOGIN_URL=https://ejemplo.cl/entrar
DELEGATED_SECRETS=
EOF2
docker compose up -d --wait
```

`DELEGATED_SECRETS` lleva el secreto de un servicio del anfitrión que entra con `signed-header` (`openssl rand -hex 32`). Sin ese servicio, `IDENTITY_PROVIDER=jwt` y la línea se borra. El miembro agente del trabajador que ejecuta no usa `DELEGATED_SECRETS`: firma con su secreto propio (sección «El trabajador que ejecuta»).

4. Comprobación con un token del anfitrión:

```sh
curl -s -H "Authorization: Bearer $JWT" https://team.ejemplo.cl/api/me
```

Responde el miembro con `"source":"jwt"`. Un correo desconocido queda creado con el rol del token; con `IDENTITY_PROVISION=closed` da 403 `member_not_registered`.

Lo que hace el servidor:

| Hecho | Detalle |
|---|---|
| Sesión propia | A un navegador identificado por el token le emite la cookie `team_session` con `Domain=.ejemplo.cl`, que vence con el `exp` del token y se renueva con cada token válido. El flujo de eventos (`/api/events`) usa esa cookie |
| Rol | El del token se aplica en cada ingreso. En Equipo, cambiarlo da 409 `role_managed_externally` |
| Cierre de sesión | Borra la sesión propia y lleva a `LOGOUT_URL`. Sin `LOGOUT_URL` el panel no dibuja el botón, porque el token del anfitrión vuelve a identificar a la persona |
| CSRF | Una petición no segura con la cookie del token o la de sesión exige `X-Team-Request`, que el panel manda |

`COOKIE_NAME` cambia el nombre de la cookie cuando dos instancias comparten dominio. No puede empezar con `__Host-`, porque ese prefijo prohíbe `Domain`.

## Cliente para la interfaz de un sitio anfitrión

`packages/client` es el paquete `@team-platform/client`. Contiene las llamadas a la API, las claves de caché, las invalidaciones, la versión al editar, el multipart y los errores del panel. Un sitio con su propio sistema de diseño dibuja sus vistas y usa el paquete para todo lo demás. Documentación y ejemplo mínimo en `packages/client/README.md`.

1. Generar el paquete desde el repositorio y copiarlo al sitio:

```sh
cd packages/client && npm install && npm pack
# deja team-platform-client-0.1.0.tgz
```

2. En el sitio anfitrión: `npm install ./team-platform-client-0.1.0.tgz`. La entrada `@team-platform/client/react` necesita `react` y `@tanstack/react-query`; el núcleo no necesita nada.
3. Crear el cliente con los valores de la instancia:

| Variable de la instancia | Opción del cliente |
|---|---|
| Dominio de Team Platform | `baseUrl: 'https://team.ejemplo.cl'` |
| `API_PREFIX` | `apiPrefix` (por omisión `/api`) |
| `COOKIE_MODE=cross-origin` | `cookieMode: 'cross-origin'` |
| `CORS_ORIGINS` | Debe incluir el origen del sitio |
| `JWT_COOKIE_NAME` o `Authorization: Bearer` | La cookie viaja sola; el token por cabecera va en `headers: () => ({ Authorization: \`Bearer ${token}\` })` |

4. Con el sitio y Team Platform en el mismo dominio (`COOKIE_DOMAIN`, sección anterior) basta `createTeamClient({ baseUrl: 'https://team.ejemplo.cl' })`.
5. Tras cambiar rutas o esquemas del servidor, `npm run gen:client` en la raíz regenera `openapi.json`, los tipos y la lista de códigos de error. Sin hacerlo, `npm test` falla en `src/client-contract.test.js`.

## El trabajador que ejecuta

Un mensaje asignado a un miembro agente lo trabaja una sesión desatendida de `claude -p` (MASTER-SPEC §7.5 «Ejecución»). El trabajo `execute` se encola al publicar el mensaje y a mano con `POST /api/messages/:id/execute`, y aparece en la Cola.

1. Crear el agente. Sólo un Editor:

```sh
curl -s -X POST https://team.ejemplo.cl/api/members \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -H 'X-Team-Request: panel' \
  -d '{"email":"agente@ejemplo.cl","name":"Agente","kind":"agent","profile":"Trabajo errores y funcionalidades del repositorio."}'
```

La respuesta trae `agent_secret` una sola vez. El trabajador lo lee de la bóveda en cada trabajo, así que no hace falta copiarlo a `.env`. El agente no tiene contraseña.

2. Variables:

| Variable | Uso |
|---|---|
| `EXECUTE_RUNNER` | `local` (omisión) o `machine` |
| `EXECUTE_CLAUDE_BIN` | Ejecutable de `claude` con `local` (omisión `claude`) |
| `EXECUTE_MACHINE_CLAUDE_BIN` | Ejecutable de `claude` dentro de la máquina (omisión `claude`) |
| `EXECUTE_REPO_DIR` | Repositorio del anfitrión con `local`; cada trabajo usa un worktree con la rama `tp/<message_id>` |
| `EXECUTE_WORK_ROOT` | Dónde se crea el directorio de cada trabajo (omisión `$DATA_DIR/tmp`) |
| `EXECUTE_TEAM_URL` | Dirección de la API que usa `team` desde la sesión (omisión `http://127.0.0.1:$PORT`). Con `machine`, una dirección que la máquina alcance |
| `EXECUTE_MODEL` | Omisión `claude-sonnet-5-5` |
| `EXECUTE_EFFORT` | Omisión `medium` |
| `EXECUTE_MAX_BUDGET_USD` | Tope de gasto por mensaje (omisión 10) |
| `EXECUTE_SESSION_RESERVE_USD` | Opcional. Lo que cada sesión reserva del día; si está, manda sobre la medición (UD-305) |
| `EXECUTE_SESSION_RESERVE_FALLBACK_USD` | Reserva mientras no hay ningún trabajo terminado del modelo con costo medido (omisión 10, cortesía declarada de UD-255) |
| `EXECUTE_MAX_TURNS` | Omisión 60 |
| `EXECUTE_MAX_SUBAGENTS` | Omisión 3 |
| `EXECUTE_MAX_ATTEMPTS` | Omisión 1 |
| `EXECUTE_TIMEOUT_MS` | Plazo de la sesión, máquina incluida (omisión 3600000) |
| `EXECUTE_KILL_GRACE_MS` | Espera entre SIGTERM y SIGKILL (omisión 10000) |
| `EXECUTE_CONTRACT_VERSION` | Versión del contrato de anfitrión que cumple el driver (`1`, o `1.2`; cuenta la mayor). El trabajador imprime al arrancar la versión del núcleo y la declarada; si la mayor difiere, no arranca y sale con código distinto de 0. `GET /health` publica la del núcleo como `contract_version`. Vacía por omisión: no se declara y no se comprueba |
| `EXECUTE_HOST_INSTRUCTIONS` | Ruta a un `.md` del anfitrión con sus reglas; se agrega al prompt en cada trabajo. Si falta el archivo, el trabajo falla con `host_instructions_missing` |
| `EXECUTE_GUARDS_FILE` | Opcional. Ruta a un JSON con las listas del anfitrión para los ganchos de toda sesión: órdenes de Bash que se niegan, herramientas que se quitan y lo que debe cumplirse al terminar. Vacía: ningún gancho. Un archivo ilegible o con un error de forma hace fallar el trabajo con `guards_file_invalid` y el motivo (ver «Guardias de la sesión» del contrato) |
| `EXECUTE_MACHINE_CREATE`, `EXECUTE_MACHINE_RUN`, `EXECUTE_MACHINE_DESTROY` | Las tres órdenes de `machine` |
| `EXECUTE_MACHINE_COLLECT` | Opcional. Copia la transcripción de la sesión antes de destruir la máquina (ver «Transcripción de la sesión») |
| `EXECUTE_CAPTURES_MAX` | Capturas de la interfaz por respuesta (omisión 3; ver «Capturas en las respuestas») |
| `EXECUTE_CAPTURES_OPEN_ZONE` | Única zona declarada con la que se adjunta una captura sin datos ocultos (omisión `ninguna`) |
| `EXECUTE_CAPTURES_UNMASKED` | `allowed` o `1`: una captura con `masked: false` se adjunta sea cual sea la zona (omisión `denied`; UD-270) |
| `EXECUTE_AUTO_CLOSE` | `on` (omisión) o `off` (también `1` y `0`). Con `on`, Claude puede cerrar el mensaje tras su respuesta final cuando se cumplen las condiciones de UD-271 (entrega con código 0 o resultado sin cambio, nada que pedirle al emisor, el «Después» de un «Antes», nadie respondió en el hilo); con `off` no cierra nunca |
| `EXECUTE_RUNS_RETENTION_DAYS` | Días que se guarda el historial de ejecuciones (omisión 365) |
| `EXECUTE_DELIVER_COMMAND` | Opcional. Orden de shell que entrega la rama a producción después de `execute`, sin IA (ver «La entrega aparte») |
| `EXECUTE_DELIVER_TIMEOUT_MS` | Plazo de esa orden (omisión 900000) |
| `EXECUTE_DELIVER_CONCURRENCY` | Entregas a producción a la vez (omisión 1): dos a la vez chocan sobre el mismo `main` |
| `EXECUTE_INFRA_RETRY_WAIT_MS` | Espera antes del segundo intento de un trabajo que falló por infraestructura: máquina que no se crea, sesión que muere sin resultado, servicio del modelo con 429 o 5xx (omisión 30000). El segundo fallo pasa el mensaje a una persona |
| `EXECUTE_DELIVER_CHECK_COMMAND` | Orden de shell que corre antes de la entrega, con `{message_id}`, `{job_id}` y `{branch}`; vacía por omisión. Código 0 = la rama ya está en producción (última línea de stdout: la referencia) y la orden de entrega no corre (UD-296). Cualquier otro código, el plazo (60 s) o un error: se entrega como siempre |
| `EXECUTE_DELIVER_RETRIES` | Tope de vueltas de una verificación fallida a Claude; sin declarar, sólo lo acota el presupuesto diario (UD-298). Con 0, el primer fallo se informa |
| `EXECUTE_DELIVER_MAX_ATTEMPTS` | Intentos del trabajo de entrega (omisión 2); el código 75 no gasta ninguno |
| `INSTANCE_NAME` | Nombre de la instancia en cada fila del historial (omisión: el host de `PUBLIC_URL`, o `local`) |

Capacidad de la máquina. Si `EXECUTE_MACHINE_CREATE` termina con código 75 (`EX_TEMPFAIL`), el anfitrión dice que ahora no hay capacidad (cuota de núcleos, ninguna máquina libre): el trabajo espera `EXECUTE_CAPACITY_WAIT_MS` y vuelve a intentar sin gastar su intento ni costo. No hay un número de máquinas ni de sesiones simultáneas (UD-304): el anfitrión crea otra máquina o dice 75, y sólo el presupuesto diario detiene un trabajo nuevo. Con 75 el anfitrión puede agregar a su error estándar la línea `##team quota machines=<N>` (las máquinas que su cuota admitió); el hilo la dice («la cuota de Google admite N máquinas»). Cuando un trabajo recibe 75, los siguientes de ese ciclo reciben la misma respuesta sin que el trabajador corra ningún guion, y una sesión que termina reabre la consulta. Cualquier otro código sigue siendo un fallo permanente.

Con `local`, la máquina de Team Platform necesita `claude` instalado y autenticado. En la imagen de Docker eso es lo mismo que el analizador `harness` (sección «Analizador `harness` en el contenedor»).

3. Una máquina por trabajo, ejemplo con Google Compute Engine:

```sh
cat >> .env <<'EOF2'
EXECUTE_RUNNER=machine
EXECUTE_TEAM_URL=https://team.ejemplo.cl
EXECUTE_HOST_INSTRUCTIONS=/data/reglas-del-agente.md
EXECUTE_MACHINE_CREATE=gcloud compute instances create team-job-{job_id} --zone=us-central1-a --machine-type=e2-standard-4 --image-family=agente-claude --image-project=mi-proyecto --quiet >&2 && echo team-job-{job_id}
EXECUTE_MACHINE_RUN=gcloud compute scp --zone=us-central1-a --recurse {workdir} {machine}:job --quiet >&2 && gcloud compute ssh {machine} --zone=us-central1-a --command 'bash job/run.sh'
EXECUTE_MACHINE_DESTROY=gcloud compute instances delete {machine} --zone=us-central1-a --quiet
EOF2
docker compose up -d --wait
```

El trabajador pone cada marcador entre comillas simples de shell antes de correr la orden. La última línea de stdout de CREATE es `{machine}`; por eso el ejemplo manda la salida de `gcloud` a stderr. El stdout de RUN debe ser sólo el NDJSON de `run.sh`. DESTROY corre siempre, también si la sesión falla, vence `EXECUTE_TIMEOUT_MS` o CREATE falló a medias. La imagen `agente-claude` es del anfitrión: trae `node`, `git`, `claude` autenticado y el repositorio; `run.sh` entra a `$TEAM_REPO_DIR` si existe. `{workdir}` lleva `env.sh` con el secreto del agente, en modo 600.

4. Comprobación: asignar un mensaje al agente y mirar la Cola. La primera respuesta del agente llega al hilo al empezar y la final al terminar. La traza del trabajo (`GET /api/jobs/:id/trace`) trae `team.session_id` y `team.cost_usd`.

### Conectar un driver y comprobar que cumple

Un driver es un directorio con las cinco órdenes del contrato (`docs/CONTRATO-DE-ANFITRION.md`) como guiones: `create.sh`, `run.sh`, `collect.sh`, `destroy.sh` y `deliver.sh`. El de referencia es `drivers/docker-local`, que corre cada trabajo en un contenedor de la misma máquina; `drivers/README.md` explica cómo escribir otro.

La prueba de conformidad corre en el clon del repositorio, fuera del contenedor del servicio. No usa la instancia instalada ni llama a Anthropic: crea su propia base efímera y pone un doble de Claude Code dentro de la máquina. Requisitos: Node 24.15 o superior y `TMPDIR` en disco si `/tmp` es memoria. Los drivers que usan Docker piden además un Docker que responda al usuario que corre la prueba.

```sh
npm ci --no-audit --no-fund
curl -fsS 127.0.0.1:3000/health          # trae "contract_version": 1, la versión del contrato que implementa el núcleo
TMPDIR=$HOME/.cache node scripts/host-conformance.mjs --driver drivers/docker-local
```

Imprime un caso por línea (`ok` o `FAIL` con el motivo) y termina con `contract_version: 1 met`. Sale con 0 sólo si todos pasan; con 1 si alguno falló; con 2 si el driver no existe. Con `drivers/docker-local` construye una imagen sin Claude Code (`team-platform-agent:conformance`) y tarda cerca de 45 s (medido el 2026-10-26 en un clon limpio de `desarrollo`). `--help` lista los casos.

Las líneas de `.env` que conectan el driver al trabajador, la imagen de la máquina y sus ajustes están en `drivers/README.md`, sección «Driver `docker-local`». `drivers/docker-local` llama a `docker` desde el trabajador. El trabajador corre entonces donde `docker` responda: en la misma máquina con `npm run worker`, o en un contenedor con el socket de Docker montado. Si declara otra versión mayor que la del núcleo, el trabajador no arranca y dice cuál esperaba. Con `drivers/fly-machines`, o con cualquier driver que sólo pida `bash` y `git`, el trabajador queda dentro del contenedor: ver «Un driver dentro del contenedor».

### Un driver dentro del contenedor

Con `EXECUTE_RUNNER=machine` el trabajador llama a las órdenes del driver como programas de su propio sistema. En la instalación de `compose.yml` el trabajador corre dentro del contenedor (`WORKER_MODE=inline`, la omisión), y la imagen no trae `bash` ni `git`, que piden los drivers. Tres piezas lo resuelven sin tocar el contenedor a mano:

| Pieza | Qué hace |
|---|---|
| `drivers/` en la imagen | Los guiones de cada driver viajan en `/app/drivers`. Las órdenes de `.env` apuntan ahí: `bash /app/drivers/fly-machines/create.sh {job_id} {workdir}` |
| `compose.driver.example.yml` | Pasa `DRIVER_PACKAGES` (omisión `bash git`) como argumento de construcción. La imagen instala esos paquetes de Alpine. Sin el archivo no se instala ninguno. `flock` y `tar` ya son comandos de busybox |
| Un archivo de compose del anfitrión | Monta de sólo lectura lo que no puede estar en `.env`: el token del driver (`TP_FLY_TOKEN_FILE=/run/secrets/fly-token`) y el archivo de `EXECUTE_HOST_INSTRUCTIONS` |

Con Docker como driver (`drivers/docker-local`) se cambia `DRIVER_PACKAGES` a `bash docker-cli` y se monta el socket de Docker en el archivo del anfitrión.

Recorrido con `drivers/fly-machines`, sobre una instalación hecha con `scripts/install.sh --no-start`:

1. La imagen de la máquina lleva Claude Code fijado (`drivers/fly-machines/Dockerfile`). Se construye y se publica en el registro de la app de Fly. El token entra por la entrada estándar de `docker login`, y con `DOCKER_CONFIG` apuntando a un directorio temporal no llega a `~/.docker`:

```sh
export DOCKER_CONFIG="$(mktemp -d)"
cat "$TOKEN_FILE" | docker login registry.fly.io -u x --password-stdin
docker build -t registry.fly.io/<app>:tp-agent drivers/fly-machines
docker push registry.fly.io/<app>:tp-agent
rm -rf "$DOCKER_CONFIG"; unset DOCKER_CONFIG
```

2. Las variables, en `.env` (sin el token): las cinco órdenes de `drivers/fly-machines/README.md`, con las rutas `/app/drivers/...`, y

```sh
TP_FLY_APP=<app>
TP_FLY_TOKEN_FILE=/run/secrets/fly-token
TP_FLY_IMAGE=registry.fly.io/<app>:tp-agent
TP_FLY_MEMORY_MB=1024
TP_FLY_MAX_LIFE_S=1200
TP_FLY_STATE=/data/driver-state
EXECUTE_RUNNER=machine
EXECUTE_CONTRACT_VERSION=1
EXECUTE_TIMEOUT_MS=600000
EXECUTE_TEAM_URL=https://<dirección pública de la instancia>
ANTHROPIC_API_KEY=…
```

`TP_FLY_STATE` va en el volumen de datos. El directorio personal del usuario del contenedor no sobrevive a recrearlo, y ahí irían el candado de creación y las transcripciones. `TP_FLY_MEMORY_MB` sube de los 256 MB de la omisión, que no alcanzan para Claude Code. `TP_FLY_MAX_LIFE_S` es el doble de `EXECUTE_TIMEOUT_MS` (regla de `drivers/fly-machines/README.md`). `ANTHROPIC_API_KEY` ya está en `.env` por el instalador y el driver la pasa a la sesión por nombre de variable.

3. `EXECUTE_TEAM_URL` es la dirección con que la máquina de Fly llama a la instancia (`team reply`, `team close`). `127.0.0.1` y los nombres internos de Docker no sirven. Una instancia en un servidor con dominio usa su dirección pública. Una instancia en una estación de trabajo publica el puerto con `tailscale funnel --bg --https=8443 localhost:$PUBLISH_PORT`, que devuelve `https://<máquina>.<tailnet>.ts.net:8443`, y se retira con `tailscale funnel --https=8443 off`. Funnel admite 443, 8443 y 10000; antes se mira `tailscale serve status` para no tomar uno ocupado.

4. Tope de gasto. Con un tope diario por debajo de las omisiones se declaran los cuatro valores juntos. La reserva por sesión es de 10 USD mientras no hay una terminada y debe caber en el día:

```sh
EXECUTE_DAILY_BUDGET_USD=0.5
EXECUTE_MAX_BUDGET_USD=0.25
EXECUTE_SESSION_RESERVE_USD=0.25
EXECUTE_MACHINE_COST_USD=0.001
```

5. Se compila y se levanta con los archivos de compose, y el nombre del proyecto fija el volumen y la red:

```sh
export COMPOSE_PROJECT_NAME=<proyecto> IMAGE_TAG=<proyecto>:local
export COMPOSE_FILE=compose.yml:compose.driver.example.yml:/ruta/al/compose-del-anfitrion.yml
scripts/install.sh
```

Arranca con `contract_version: core 1, driver declares 1` en el registro. Si el driver declarara otra versión mayor, el trabajador no arranca.

### Comprobación con el canario, dentro de la instancia

Un editor con contraseña conocida hace falta para el canario. `scripts/install.sh` genera la del primer Editor y la muestra una vez; para una instalación sin terminal se fija `ADMIN_PASSWORD` en `.env` (por ejemplo `openssl rand -hex 24`) antes del primer arranque. El canario corre en el contenedor. Ahí la API es `http://127.0.0.1:$PORT` y las credenciales ya están en el entorno, así que ninguna pasa por la línea de órdenes:

```sh
docker compose exec -T team-platform sh -c 'TEAM_URL="http://127.0.0.1:$PORT" TEAM_EMAIL="$ADMIN_EMAIL" TEAM_PASSWORD="$ADMIN_PASSWORD" CANARY_AREA=Canario CANARY_CREATE=1 CANARY_AGENT=agente@ejemplo.invalid CANARY_AREA_MODEL=claude-haiku-5-5 node scripts/canary.mjs'
```

`CANARY_CREATE=1` crea el área y el miembro agente que falten. Sale 0 y la última línea es `CANARY OK: the agent replied in …` cuando el agente responde «OK» en el hilo (medido el 2026-10-27 con Fly y Claude Haiku 5.5: 70 a 73 s de punta a punta, de ellos 51 a 54 s la sesión, y entre 0,001 y 0,002 USD cada sesión). Si sale 3, la última línea nombra el tramo (`session` es el driver y la máquina; `reply`, la dirección `EXECUTE_TEAM_URL`).

Al terminar, `flyctl machines list -a <app>` no debe mostrar ninguna máquina `tp-job-*`: el trabajador destruye la suya y Fly retira cualquier otra al vencer `TP_FLY_MAX_LIFE_S`.

### La entrega aparte

Sin `EXECUTE_DELIVER_COMMAND`, la sesión de Claude entrega a producción por las reglas del anfitrión y espera el despliegue. Con la orden declarada, la sesión termina al empujar la rama `tp/<id>` y la máquina se destruye. Después, un trabajo `deliver` hace la entrega en el host del trabajador, sin IA. El autor recibe una sola respuesta final cuando la entrega termina.

| Elemento | Contrato |
|---|---|
| Marcadores | `{message_id}`, `{job_id}`, `{branch}`, `{workdir}` (directorio vacío que se borra al terminar). Entre comillas simples de shell |
| Entorno | `TEAM_MESSAGE_ID`, `TEAM_JOB_ID`, `TEAM_BRANCH`, `TEAM_WORKDIR`, `TEAM_DELIVER_ROUND`, `TEAM_DELIVER_ATTEMPT`, `TEAM_OUTPUT_JSON` (la salida estructurada de la sesión sin el `summary`, en JSON compacto; `{}` si la entrega se lanzó sin salida). La plataforma no interpreta sus campos: la orden decide con ellos |
| Código 0 | Quedó en producción. La última línea de stdout es la referencia: un commit, una URL o una etiqueta |
| Código 75 | No puede ahora. El trabajo espera `EXECUTE_CAPACITY_WAIT_MS` y vuelve a correr sin gastar intento |
| Código 76 | No se entrega sola: espera la revisión de una persona. La última línea de stdout es el motivo en lenguaje llano (por ejemplo «el cambio toca pagos»). No se reintenta ni vuelve a Claude. El trabajo termina como hecho con `delivered = 0`, sin referencia. Una sola respuesta con el `summary`, el motivo y `outcome: needs_decision` va a quien decide en el área (UD-269), que recibe el mensaje en su bandeja. La ficha de la ejecución lleva `delivery_held = 1` y el resumen lo cuenta aparte de «entregado» y «falló» |
| Otro código | Fallo. stdout y stderr son el motivo. Mientras alcance el presupuesto diario (y las vueltas de `EXECUTE_DELIVER_RETRIES`, si se declara), un `execute` nuevo recibe esa salida en su prompt, corrige sobre la misma rama y vuelve a entregar. Cuando se agota, el autor recibe «No quedó en producción: <motivo>», con `outcome: blocked` |
| Plazo | `EXECUTE_DELIVER_TIMEOUT_MS`. Vencido, se mata el grupo de procesos de la orden y el autor recibe el aviso; no vuelve a Claude |
| Fases | Opcional. Las líneas `##team phase verify` y `##team phase deploy` de stdout mueven el progreso que ven la tarjeta del mensaje y la Cola |
| Captura del después | Opcional (UD-268). `TEAM_BEFORE_CAPTURES` trae la lista JSON `[{ place, as, width, height }]` del antes de la primera respuesta. Con código 0, la orden puede dejar una imagen en `$TEAM_WORKDIR/captures` e imprimir `##team capture <json>` (`{ path, alt, masked, place, as }`), o `##team capture-failed <motivo>`, que la respuesta final dice en una línea. La captura de la sesión sólo vale si no hubo antes con lugar |
| Repetición | La orden debe poder correr dos veces sobre la misma rama |

Ejemplo genérico: trae la rama, corre sólo las pruebas críticas, despliega y deja el commit como referencia. La salida de las herramientas va a stderr para que la última línea de stdout sea la referencia.

```sh
EXECUTE_DELIVER_COMMAND=cd /srv/app && git fetch -q origin {branch} >&2 && echo '##team phase verify' && ./pruebas-criticas.sh origin/{branch} >&2 && echo '##team phase deploy' && ./desplegar.sh origin/{branch} >&2 && git rev-parse --short origin/{branch}
```

Para que la orden diga «ahora no» (por ejemplo, otro despliegue en curso), se antepone `./hay-lugar.sh || exit 75 &&`. Un Editor lanza la entrega de un mensaje a mano con `POST /api/messages/:id/deliver`; responde 202 con el trabajo, o 409 `deliver_not_configured`, `execute_busy`, `deliver_busy`, `no_agent_assignee` o `message_closed`.

El prompt de la sesión agrega una sección después de `EXECUTE_HOST_INSTRUCTIONS`, con precedencia sobre ellas. Dice que la entrega la hace el sistema. La sesión termina al empujar la rama con las verificaciones y la marca del juez que pidan las reglas del anfitrión. El texto de esas reglas sigue siendo del anfitrión.

### Transcripción de la sesión

La transcripción de la sesión de Claude (`~/.claude/projects/*/*.jsonl` en la máquina) desaparece con ella. `EXECUTE_MACHINE_COLLECT` es una orden de shell, con los marcadores `{job_id}`, `{workdir}` y `{machine}`, que corre después de RUN y antes de DESTROY, también si la sesión falló o venció. No corre si CREATE falló ni si el trabajo se canceló. Su última línea no vacía de stdout es la ruta local o la clave del objeto donde dejó la transcripción, y queda en `transcript_ref` del historial. Con código distinto de 0 o sin salida, la referencia queda vacía y el trabajo sigue igual. Sin la orden no se copia nada. Plazo: `EXECUTE_TIMEOUT_MS`.

Ejemplo genérico, con `scp` y un directorio del anfitrión; la salida de `scp` va a stderr para que la última línea de stdout sea la ruta:

```sh
EXECUTE_MACHINE_COLLECT=mkdir -p /data/transcripciones/{job_id} && scp -q -r {machine}:.claude/projects /data/transcripciones/{job_id}/ >&2 && echo /data/transcripciones/{job_id}
```

Con un almacén de objetos, la última línea es la clave: `gcloud storage cp -r ... gs://bucket/{job_id}/ >&2 && echo gs://bucket/{job_id}/`. Cuánto tiempo se guardan las transcripciones lo decide el anfitrión (por ejemplo, una regla de ciclo de vida del bucket). La plataforma sólo guarda la referencia.

### Revisión de un cambio retenido (UD-275, UD-280)

Desde UD-280 la ficha no tiene botones: la persona responde en el hilo mencionando a Claude y el modelo decide con `review` si entregar, descartar, iterar o sólo responder; el sistema entrega o descarta sólo para un Editor. Las rutas `POST /messages/:id/deliver` y `/discard-delivery` siguen disponibles.

Una orden de entrega que sale con 76 deja el cambio esperando a una persona, que lo ve en la ficha del mensaje, en «Revisión». Cuando una persona activa del equipo aprueba, o la sesión declara en `approved` que quien la mencionó ya pidió implementar y publicar (UD-286), la orden corre con `TEAM_REVIEWED_BY` fijada al id de esa persona: una orden que retiene no debe retener otra vez cuando viene fijada. Para que la persona vea cómo queda, la sesión graba el recorrido con `team walkthrough --url <dirección de la vista de la rama> --steps <json|archivo> --place <ruta> --as <rol> [--profile desktop|phone|both]`, que necesita Playwright y un Chromium en la máquina de la sesión (sin ellos lo dice en una línea y sigue con las capturas). El video y las capturas de cada paso se declaran en `captures` y se adjuntan con el rótulo «Propuesta».

### Capturas en las respuestas

La sesión puede adjuntar capturas de la interfaz del anfitrión a sus dos respuestas (UD-268). La herramienta que las toma es del anfitrión; la plataforma sólo recibe archivos.

| Dónde | Cómo |
|---|---|
| Primera respuesta («Antes») | `team reply <id> --body "…" --captures '[{"path":"antes.png","alt":"…","masked":true,"place":"…","as":"…"}]' [--zone <zona>]` |
| Respuesta final («Después») | `captures`, la misma lista, en la salida estructurada |

Los archivos van en `$TEAM_CAPTURES_DIR` (el directorio `captures/` del trabajo) y `path` es relativo a él. Campos de cada captura: `alt` una línea; `masked` `true` o `false`; `place` la ruta o el menú de la vista; `as` la clínica y el rol con que se miró. PNG, JPEG o WebP, hasta `EXECUTE_CAPTURES_MAX` por respuesta y el tope de imagen de un adjunto (`UPLOAD_MAX_IMAGE_BYTES`). Con `masked: false`, la captura se adjunta sólo si la zona declarada (`zone` de la salida, `--zone` en la primera respuesta) es `EXECUTE_CAPTURES_OPEN_ZONE`. Lo que no cumple se deja fuera con un aviso (`captures.rejected` en el span `execute`; `team reply` lo escribe en stderr) y la respuesta sale igual.

La respuesta final adjunta la «Antes» de la última respuesta de la sesión que la trae, y la «Después». Cada adjunto se llama «Antes - <alt>» o «Después - <alt>»; el panel lo muestra bajo la imagen. Con `EXECUTE_RUNNER=machine`, `EXECUTE_MACHINE_COLLECT` copia `captures/` de la máquina a `{workdir}/captures` antes de destruirla (la ruta de la máquina es `$JOB_DIR/captures`); sin esa copia la captura final se deja fuera.

**Documentos de un reenvío (UD-272).** Un mensaje reenviado a un agente con un motivo que pide un PDF lo deja en `$TEAM_ATTACHMENTS_DIR` (el directorio `attachments/` del trabajo) y lo declara en `attachments` de la salida estructurada. La respuesta lo adjunta si la ruta queda dentro del directorio, empieza con `%PDF-`, pesa hasta `UPLOAD_MAX_DOCUMENT_BYTES` y no se pasa de `UPLOAD_MAX_FILES`; si no, la respuesta dice cuál quedó fuera y por qué. Con `EXECUTE_RUNNER=machine`, `EXECUTE_MACHINE_COLLECT` debe copiar también `attachments/` de la máquina a `{workdir}/attachments` (la ruta de la máquina es `$JOB_DIR/attachments`); sin esa copia el documento se deja fuera.

**Menciones (UD-278).** Una respuesta que menciona a un agente le da el hilo completo y los adjuntos del mensaje y de las respuestas en el directorio `thread/` del trabajo (`$TEAM_THREAD_DIR`). Con `EXECUTE_RUNNER=machine` viaja con `{workdir}` y `run.sh` apunta la variable a su copia en la máquina; no hace falta ninguna orden nueva.

Texto para las instrucciones de las sesiones del anfitrión (`EXECUTE_HOST_INSTRUCTIONS`), con el nombre de la herramienta del anfitrión en lugar de `<captura>`:

```
## Capturas
Examina la situación antes de cambiar nada: mira el lugar al que se refiere el mensaje, con la cuenta y el rol de quien lo reportó.
Si ayuda, toma una captura del estado actual con <captura> en $TEAM_CAPTURES_DIR y descríbela. Decide si el problema existe hoy.
Primera respuesta: `team reply <id> --body "<lo que ves y que empiezas>" --captures <lista> --zone <zona>`.
Si el problema ya está resuelto, dilo con la captura que lo muestra y no cambies nada.
Después del arreglo, toma una captura del mismo lugar y decláralas en `captures` de la salida.
```

## Dónde mirar los tiempos

Cada ejecución del harness deja una fila en `execute_runs`: tiempos por fase, tokens, costo, resultado, entrega y la referencia a la transcripción. Se guarda 365 días. Los spans de la traza duran 7.

| Quién | Cómo |
|---|---|
| Una sesión de Claude u otra persona con acceso al servidor, sin credenciales de la API | `docker exec <contenedor> node scripts/tiempos.mjs --resumen` |
| Lo mismo sobre una copia de la base | `DATA_DIR=/ruta/a/la/copia node scripts/tiempos.mjs --resumen` |
| Un Editor, en el panel | Configuración, Cola, «Ejecuciones» |
| Un Editor o un programa, por la API | `GET /api/ops/execute-runs` y `GET /api/ops/execute-runs/summary` |
| Un mensaje, con su traza completa | `team timing <message_id>` y `GET /api/jobs/:id/trace` (7 días) |

Texto de dos líneas para las instrucciones de las sesiones del anfitrión (`EXECUTE_HOST_INSTRUCTIONS` y su propio archivo de reglas):

```
Para ver tiempos: docker exec <contenedor> node scripts/tiempos.mjs --resumen
Para ver una ejecución: docker exec <contenedor> node scripts/tiempos.mjs --mensaje <id_del_mensaje>   (últimas: --ultimos 20)
```

Consultas de `scripts/tiempos.mjs`:

```sh
docker exec <contenedor> node scripts/tiempos.mjs --ultimos 20
docker exec <contenedor> node scripts/tiempos.mjs --mensaje 123
docker exec <contenedor> node scripts/tiempos.mjs --resumen --desde 2026-10-01
docker exec <contenedor> node scripts/tiempos.mjs --resumen --json
```

El script abre la base en solo lectura: `DB_PATH`, o `DATA_DIR/team.db` (en el contenedor, `DATA_DIR=/data`). Muestra una instancia a la vez: la de la ejecución más reciente o la de `--instancia NOMBRE`. `--todas` junta todas. El resumen da promedio, p50 y p95 por fase, costo medio y total, tasa de entrega, tasa de «ya resuelto» (resultado `investigated`) y las diez herramientas más lentas. Una cifra sin dato se muestra «—»: juez, entrega y espera sólo existen si la sesión las informó con `team mark`.

Cuánto se guarda: `EXECUTE_RUNS_RETENTION_DAYS`. El historial no se borra con «Vaciar contenido».

## Licencias

El código es MIT. La imagen incluye el binario `ffmpeg` compilado en la imagen en configuración LGPL (LGPL 2.1; ver `NOTICE` y `/usr/share/licenses/ffmpeg/`).
