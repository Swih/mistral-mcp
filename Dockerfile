FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# process_document writes its cache here. Owned by the runtime user so the
# container can run with a read-only root filesystem and a mounted volume.
ENV MISTRAL_MCP_CACHE_DIR=/var/cache/mistral-mcp
RUN mkdir -p /var/cache/mistral-mcp && chown -R node:node /var/cache/mistral-mcp

# Never run as root: Kubernetes `runAsNonRoot: true` and the compose
# `no-new-privileges` hardening both depend on this.
USER node

# stdio is the default. For remote deployments pass
# MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 and publish this port.
EXPOSE 3333

CMD ["node", "dist/index.js"]
