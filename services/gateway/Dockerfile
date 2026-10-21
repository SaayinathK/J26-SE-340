FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
COPY __tests__ ./__tests__
USER node
EXPOSE 4000
CMD ["node", "src/server.js"]
