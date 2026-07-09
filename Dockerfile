# Stage 1: Backend dependencies (all — needed to compile TypeScript)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the root "postinstall" runs `prisma generate`, which needs
# prisma/schema.prisma + prisma.config.ts (not present in this deps-only stage).
# The Prisma client is generated explicitly in the build stage instead.
# BuildKit cache mount keeps the npm download cache across builds so packages
# are only re-downloaded when the registry content changes, not on every build.
RUN --mount=type=cache,id=npm-root,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund --prefer-offline

# Stage 1c: Admin UI dependencies
FROM node:22-alpine AS admin-deps
WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN --mount=type=cache,id=npm-admin,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline

# Stage 2: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=admin-deps /app/admin-ui/node_modules ./admin-ui/node_modules
COPY . .
# Build admin UI
RUN cd admin-ui && npm run build
# Build NestJS backend
RUN npx prisma generate
RUN npm run build
# Copy admin-ui build output into dist
RUN cp -r admin-ui/dist dist/admin-ui
# Strip dev dependencies in-place so the production stage can copy a lean
# node_modules tree directly — no second `npm ci` and no image bloat from
# deleting files in a later layer.
RUN --mount=type=cache,id=npm-root,target=/root/.npm \
    npm prune --omit=dev --ignore-scripts --no-audit --no-fund

# Stage 3: Production
FROM node:22-alpine AS production
WORKDIR /app

# Copy the already-pruned (production-only) node_modules from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/themes ./themes
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json

# Re-generate the Prisma client against the pruned production node_modules so
# the query engine binary matches the Alpine runtime and survives the prune.
RUN node_modules/.bin/prisma generate --schema=prisma/schema.prisma

# prisma.config.ts is TypeScript and cannot be executed directly by Node in the
# production image (no compiler present).  migrate deploy only needs the schema
# file, which is already present under ./prisma/schema.prisma — the --schema flag
# is passed explicitly in docker-entrypoint.sh instead.

# Use the existing 'node' user (UID 1000, GID 1000) from the base image
# instead of creating a new group/user that conflicts with the pre-existing GID

ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q --spider http://localhost:3000/health/ready || exit 1

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Ensure the app directory is owned by the non-root user
RUN chown -R node:node /app

USER node
ENTRYPOINT ["/docker-entrypoint.sh"]
