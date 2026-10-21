# Instalación

Requisitos: Docker 25 o superior con el plugin `compose` (el `HEALTHCHECK` usa `--start-interval`, desde Docker 25). La imagen ocupa 466 MB según `docker images` (medidos el 2026-10-20; 344 MB de contenido según `du`): 132 MB del binario de Node, 146 MB de Alpine con `ffmpeg` y 62 MB de dependencias de producción podadas (detalle en `docs/investigaciones/mediciones/2026-10-20-imagen-docker.md`). La base y los adjuntos viven en el volumen `/data`, que tiene que ser disco local. SQLite en modo WAL no funciona sobre sistemas de archivos de red.

La aplicación escucha en el puerto 3000 del contenedor. `compose.yml` lo publica sólo en `127.0.0.1`. El acceso desde fuera del servidor lo da un proxy con TLS (formas 1 y 3) o la red del proyecto anfitrión (forma 2). La cookie de sesión es `__Host-` con `Secure`: sin HTTPS no inicia sesión, salvo en `localhost`.

## Variables

`scripts/install.sh` crea `.env` desde `.env.example` (modo 600) y pide lo mínimo.

| Variable | Uso |
|---|---|
| `ADMIN_EMAIL` | Correo del primer Editor |
| `ANTHROPIC_API_KEY` | Texto, visión y PDF |
| `GROQ_API_KEY` | Transcripción de audio y video. Sin ella no se transcribe |
| `DEEPSEEK_API_KEY` | Proveedor de respaldo, opcional |
| `PUBLISH_PORT` | Puerto en el anfitrión. Vacío usa 3000 |

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
```

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

Restaurar una copia, con el servicio detenido:

```sh
docker compose stop
docker compose run --rm --no-deps -v "$PWD/backups:/restore:ro" --entrypoint sh team-platform \
  -c 'rm -f /data/team.db-wal /data/team.db-shm && cp /restore/team-<fecha>.db /data/team.db'
docker compose start
```

## Licencias

El código es MIT. La imagen incluye el binario `ffmpeg` del repositorio de Alpine, con la licencia de ese paquete.
