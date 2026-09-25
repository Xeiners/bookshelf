# syntax=docker/dockerfile:1.7
#
# API Bookshelf — image de production (Node.js + Prisma + PostgreSQL).
#
# Contexte de build : la RACINE du monorepo (un seul package-lock.json pour les
# workspaces npm) :
#   docker build -f backend/Dockerfile -t bookshelf-api .
# Fichiers exclus : backend/Dockerfile.dockerignore.

ARG NODE_VERSION=22

# ---- Base commune --------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS base
# OpenSSL : requis par le moteur de migration Prisma sur Alpine (musl).
RUN apk add --no-cache openssl
WORKDIR /app

# ---- Développement (docker-compose.dev.yml) ---------------------------------------
# Le code est monté depuis l'hôte, les dépendances vivent dans des volumes : cette
# étape ne fournit que l'environnement (Node + OpenSSL). Démarrage : cf. le compose.
FROM base AS dev
WORKDIR /app/backend
EXPOSE 5000

# ---- Dépendances + compilation -------------------------------------------------
FROM base AS builder
COPY package.json package-lock.json ./
COPY backend/package.json backend/
# npm vérifie le lockfile contre TOUS les workspaces déclarés : le manifeste du
# front suffit (ses dépendances ne sont pas installées, cf. `-w backend`).
COPY frontend/package.json frontend/
# Le `postinstall` du backend lance `prisma generate` : il lui faut le schéma.
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
# Dépendances optionnelles INCLUSES : TypeScript 7 (compilateur natif) en est
# une. Le pilote SQLite, natif lui aussi, peut échouer à se compiler ici : il
# n'est atteint que par une dépendance optionnelle, npm l'ignore alors.
RUN --mount=type=cache,target=/root/.npm npm ci --workspace backend --no-audit --no-fund
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/scripts backend/scripts
COPY backend/src backend/src
# Clients Prisma SQLite ET PostgreSQL, puis TypeScript → dist/.
RUN npm run build --workspace backend

# ---- Dépendances de production seules ------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
# Sans devDependencies ni optionnelles : ni compilateur, ni pilote SQLite natif.
RUN --mount=type=cache,target=/root/.npm npm ci --workspace backend --omit=dev --omit=optional --no-audit --no-fund \
  && mkdir -p backend/node_modules

# ---- Image finale ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=5000
# Ni npm ni yarn à l'exécution : moins de poids, moins de surface d'attaque.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/lib/node_modules/corepack /usr/local/bin/corepack \
      /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --chown=node:node backend/package.json backend/prisma.config.ts ./backend/
COPY --chown=node:node backend/prisma ./backend/prisma
COPY --from=builder --chown=node:node /app/backend/dist ./backend/dist

WORKDIR /app/backend
# Jamais root à l'exécution.
USER node
EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/api/health > /dev/null || exit 1

# Migrations d'abord (idempotentes), puis l'API. Binaire Prisma appelé directement
# (npm est retiré de l'image). `exec` : Node reçoit SIGTERM, l'arrêt est propre
# (cf. `shutdown` dans src/index.ts).
CMD ["sh", "-c", "../node_modules/.bin/prisma migrate deploy && exec node dist/index.js"]
