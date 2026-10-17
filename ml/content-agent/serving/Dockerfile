FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node pending.cjs ./pending.cjs
USER node
EXPOSE 11434
CMD ["node","pending.cjs"]
