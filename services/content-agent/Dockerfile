FROM node:22-alpine
WORKDIR /app
ENV COMPONENT_NAME=content-agent HOST=0.0.0.0 PORT=4002
COPY --chown=node:node src ./src
USER node
EXPOSE 4002
CMD ["node", "src/main.cjs"]
