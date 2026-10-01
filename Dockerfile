# ---- build stage ----
# (Debian slim, not Alpine: the Temporal TypeScript SDK ships glibc native binaries)
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# The same image runs both processes; docker-compose overrides CMD for the worker.
CMD ["node", "dist/server.js"]
