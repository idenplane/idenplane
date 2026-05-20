# Stage 1: Dependencies
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the root "postinstall" runs `prisma generate`, which needs
# prisma/schema.prisma + prisma.config.ts (not present in this deps-only stage).
# The Prisma client is generated explicitly in the build stage instead.
RUN npm ci --ignore-scripts

# Stage 1b: Admin UI dependencies
FROM node:26-alpine AS admin-deps
WORKDIR /app/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci

# Stage 2: Build
FROM node:26-alpine AS build
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

# Stage 3: Production
FROM node:26-alpine AS production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/themes ./themes
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json

# prisma.config.ts is TypeScript and cannot be executed directly by Node in the
# production image (no compiler present).  migrate deploy only needs the schema
# file, which is already present under ./prisma/schema.prisma — the --schema flag
# is passed explicitly in docker-entrypoint.sh instead.

# Remove dev dependencies in production stage (not build stage)
RUN npm prune --omit=dev

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
