# syntax=docker/dockerfile:1

# Etapa 1: panel. Compila panel/ si existe; si no, deja un directorio vacío.
# Se copia todo el contexto porque COPY falla cuando panel/ no existe.
FROM node:24-alpine AS panel
WORKDIR /ctx
COPY . /ctx
RUN mkdir -p /out \
 && if [ -f panel/package.json ]; then \
      cd panel \
      && if [ -f package-lock.json ]; then npm ci; else npm install; fi \
      && npm run build \
      && cp -r dist/. /out/; \
    fi

# Etapa 2: dependencias de producción del servidor.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN mkdir -p node_modules \
 && if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# Etapa final. ffmpeg del repositorio de Alpine (informe 06, sección 1.2).
# La imagen incluye el binario de ffmpeg con la licencia de su paquete.
FROM node:24-alpine
LABEL org.opencontainers.image.title="team-platform" \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    PANEL_DIR=/app/panel/dist
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY templates ./templates
COPY --from=panel /out ./panel/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
# Cadencia de arranque: --start-period cubre el arranque medido (2 s con el relleno;
# el núcleo real suma sus migraciones) y --start-interval hace que `up --wait` no espere
# la cadencia normal de 30 s. Son valores de comodidad, no gobiernan la operación.
HEALTHCHECK --start-period=15s --start-interval=1s CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1
# Forma exec: node es PID 1 y recibe SIGTERM directo.
CMD ["node", "src/server.js"]
