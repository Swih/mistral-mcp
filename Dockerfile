FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.test.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# stdio is the default. For Mistral Connectors / remote deployments,
# pass MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 and expose port 3333.
EXPOSE 3333

CMD ["node", "dist/index.js"]
