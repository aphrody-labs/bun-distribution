# Syntax=docker/dockerfile:1
# Build context: repository root. Compatible with Fly.io and Cloud Run.
FROM node:22-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm install --global bun@1.4.2
WORKDIR /workspace

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.json turbo.json ./

# The lockfile is authoritative. Lifecycle scripts are deferred because cloud
# builds have neither a Discord token nor native browser tooling.
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun --cwd apps/website run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080

WORKDIR /app
RUN useradd --system --uid 1001 nextjs

# Next standalone contains only traced production dependencies.
COPY --from=build --chown=nextjs:nextjs /workspace/apps/website/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /workspace/apps/website/.next/static ./apps/website/.next/static
COPY --from=build --chown=nextjs:nextjs /workspace/apps/website/public ./apps/website/public

USER nextjs
WORKDIR /app/apps/website
EXPOSE 8080
CMD ["node", "server.js"]
