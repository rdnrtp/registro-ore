# Prove nel browser della pagina compilata (servizio "e2e" del Compose).
# La versione dell'immagine deve essere quella di @playwright/test.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /e2e
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npx", "playwright", "test"]
