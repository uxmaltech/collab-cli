FROM node:22-alpine

WORKDIR /app
COPY package.json /app/package.json
COPY server.mjs /app/server.mjs
COPY scripts/ /app/scripts/

EXPOSE 7337

CMD ["node", "/app/server.mjs"]
