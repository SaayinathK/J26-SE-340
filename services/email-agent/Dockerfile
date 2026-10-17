FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/migrate.js ./scripts/migrate.js
COPY --chown=node:node db/migrations ./db/migrations
ENV NODE_ENV=production
USER node
EXPOSE 4001
CMD ["node", "src/main.js"]
