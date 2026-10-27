FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Immagine per i test: include le dipendenze di sviluppo e il client di
# PostgreSQL 17 (pg_dump e pg_restore, per la prova del backup delle ricevute).
FROM base AS test
RUN apk add --no-cache postgresql17-client
RUN npm ci
COPY . .
USER node
CMD ["npm", "test"]

# Immagine di produzione (ultimo stage = predefinito).
FROM base AS prod
ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY migrations ./migrations
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
