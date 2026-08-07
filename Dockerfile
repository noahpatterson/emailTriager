# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14 AS migrate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts ./
COPY db ./db
ENV NODE_ENV=development
CMD ["bun", "run", "db:migrate"]

FROM oven/bun:1.3.14 AS migrate-demo
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts ./
COPY db ./db
COPY scripts/migrate-demo.ts ./scripts/migrate-demo.ts
ENV NODE_ENV=development
CMD ["bun", "run", "db:migrate:demo"]

FROM oven/bun:1.3.14 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Compile-time placeholders only (not real secrets). Runtime Compose / .env overrides.
# ARG keeps these out of the final runner image ENV; values are dummies for Next build.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ARG DATABASE_DRIVER=neon-http
ARG NEON_AUTH_BASE_URL=https://build.invalid
ARG NEON_AUTH_COOKIE_SECRET=build-cookie-secret-at-least-32-chars!!
ARG OWNER_NEON_AUTH_USER_ID=build-owner
ARG GOOGLE_CLIENT_ID=build-client-id
ARG GOOGLE_CLIENT_SECRET=build-only-not-a-secret
ARG GOOGLE_REDIRECT_URI=http://localhost:3000/api/oauth/google/callback
ARG TOKEN_ENCRYPTION_KEY_V1=build-only-dummy-token-key-not-secret
ENV DATABASE_URL=$DATABASE_URL \
    DATABASE_DRIVER=$DATABASE_DRIVER \
    NEON_AUTH_BASE_URL=$NEON_AUTH_BASE_URL \
    NEON_AUTH_COOKIE_SECRET=$NEON_AUTH_COOKIE_SECRET \
    OWNER_NEON_AUTH_USER_ID=$OWNER_NEON_AUTH_USER_ID \
    GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID \
    GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET \
    GOOGLE_REDIRECT_URI=$GOOGLE_REDIRECT_URI \
    TOKEN_ENCRYPTION_KEY_V1=$TOKEN_ENCRYPTION_KEY_V1
RUN bun run build

FROM oven/bun:1.3.14 AS runner
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Local Compose sets NODE_ENV=development (insecure local mode refuses production).
# Production deploys must set NODE_ENV=production and must NOT set insecure flags.
ENV NODE_ENV=development
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 --create-home nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
# Next standalone server.js hardcodes NODE_ENV=production; preserve Compose/dev override for insecure local.
RUN sed -i "s/process.env.NODE_ENV = 'production'/process.env.NODE_ENV = process.env.NODE_ENV || 'production'/" server.js
USER nextjs
EXPOSE 3000
CMD ["bun", "server.js"]
