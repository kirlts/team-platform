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

Actualizar, con respaldo previo:

```sh
scripts/backup.sh
git pull
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

## Licencias

El código es MIT. La imagen incluye el binario `ffmpeg` compilado en la imagen en configuración LGPL (LGPL 2.1; ver `NOTICE` y `/usr/share/licenses/ffmpeg/`).
