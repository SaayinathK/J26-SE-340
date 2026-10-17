FROM node:22-alpine
WORKDIR /app
ENV COMPONENT_NAME=strategy-fl HOST=0.0.0.0 PORT=4004
COPY --chown=node:node src ./src
USER node
EXPOSE 4004
CMD ["node", "src/main.cjs"]
