# syntax=docker/dockerfile:1

# ───────── build ─────────
# La compilación es JavaScript puro: se hace siempre en la plataforma del constructor
# (rápido, sin emulación) aunque la imagen final sea para amd64 o arm64.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/sdk/package.json packages/sdk/
RUN npm ci
COPY . .
RUN npm run build

# ───────── runtime ─────────
# El servidor se empaqueta en un solo archivo: no hace falta node_modules.
FROM node:24-alpine
LABEL org.opencontainers.image.title="Oblivion" \
      org.opencontainers.image.description="Dashboard autoalojado, seguro y personalizable para tu homelab" \
      org.opencontainers.image.source="https://github.com/sebastianvelezg/OBLIVION" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"
ENV NODE_ENV=production \
    PORT=3000 \
    OBLIVION_DATA_DIR=/data \
    OBLIVION_PLUGINS_DIR=/app/plugins \
    OBLIVION_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /app/apps/server/dist/index.js ./server/index.js
COPY --from=build /app/apps/web/dist ./web
COPY plugins ./plugins
RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
