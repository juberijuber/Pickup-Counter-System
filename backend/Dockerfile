FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vitest.config.ts ./
COPY sql ./sql
COPY src ./src
COPY tests ./tests
RUN npm run build
EXPOSE 3000
CMD ["sh", "-c", "node dist/migrate.js && node dist/seed.js && node dist/index.js"]
