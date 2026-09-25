# syntax=docker/dockerfile:1.7
#
# Front Bookshelf (PWA) — build Vite, servi par Nginx.
#
# Contexte de build : la RACINE du monorepo (un seul package-lock.json) :
#   docker build -f frontend/Dockerfile -t bookshelf-web .
# Fichiers exclus : frontend/Dockerfile.dockerignore.

ARG NODE_VERSION=22

# ---- Build ------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
# Optionnelles incluses : Vite, Rolldown, Tailwind et TypeScript 7 livrent leurs
# binaires natifs par plateforme sous cette forme.
RUN --mount=type=cache,target=/root/.npm npm ci --workspace frontend --no-audit --no-fund
COPY frontend frontend

# URL de l'API vue par le NAVIGATEUR. Par défaut `/api` : même origine, Nginx
# relaie vers le conteneur backend (pas de CORS, cookies de session simples).
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace frontend

# ---- Service statique ---------------------------------------------------------------
FROM nginx:1.27-alpine AS runner
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz > /dev/null || exit 1
