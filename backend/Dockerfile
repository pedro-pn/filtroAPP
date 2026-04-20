FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/backend

COPY backend/package*.json ./
RUN npm ci

COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/src ./src
COPY backend/assets ./assets
RUN mkdir -p /data/assets && cp -R ./assets/. /data/assets/
COPY filtrovali_app_v4.html /workspace/filtrovali_app_v4.html
COPY Modelos /workspace/Modelos

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
