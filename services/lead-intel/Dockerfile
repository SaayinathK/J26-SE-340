FROM node:22-alpine
WORKDIR /app
ENV COMPONENT_NAME=lead-intel HOST=0.0.0.0 PORT=4003
COPY --chown=node:node src ./src
USER node
EXPOSE 4003
CMD ["node", "src/main.cjs"]
