# CTRL+AI frontend (Next.js standalone) — the `web` service in
# docker-compose.prod.yml.
#
# Built by GitHub Actions, not on the server. BACKEND_ORIGIN is a BUILD
# argument: Next.js compiles the /api/* rewrite (next.config.ts) into the
# build, so changing it later means building a new image, not editing .env.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
# Where the Next.js server forwards /api/*: the `api` service by its
# compose name. Never a NEXT_PUBLIC_ value — the browser never sees it.
ARG BACKEND_ORIGIN=http://api:8000
ENV BACKEND_ORIGIN=$BACKEND_ORIGIN \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# The standalone server, plus the two folders it does not copy itself.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
