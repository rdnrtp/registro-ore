FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# Immagine per i test: include le dipendenze di sviluppo.
FROM base AS test
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
