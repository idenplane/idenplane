FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_IDENPLANE_SERVER_URL=http://localhost:3000
ARG NEXT_PUBLIC_IDENPLANE_REALM=quickstart
ARG NEXT_PUBLIC_IDENPLANE_CLIENT_ID=nextjs-quickstart
ARG NEXT_PUBLIC_IDENPLANE_REDIRECT_URI=http://localhost:3001/callback
ENV NEXT_PUBLIC_IDENPLANE_SERVER_URL=$NEXT_PUBLIC_IDENPLANE_SERVER_URL \
    NEXT_PUBLIC_IDENPLANE_REALM=$NEXT_PUBLIC_IDENPLANE_REALM \
    NEXT_PUBLIC_IDENPLANE_CLIENT_ID=$NEXT_PUBLIC_IDENPLANE_CLIENT_ID \
    NEXT_PUBLIC_IDENPLANE_REDIRECT_URI=$NEXT_PUBLIC_IDENPLANE_REDIRECT_URI
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs

EXPOSE 3001
CMD ["npm", "run", "start"]
