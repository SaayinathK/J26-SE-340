FROM node:22-alpine AS build
WORKDIR /workspace
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --chown=node:node scripts/serve.cjs ./scripts/serve.cjs
ENV HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "scripts/serve.cjs"]
