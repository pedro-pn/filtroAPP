FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer fonts-dejavu-core ca-certificates python3 python3-venv hunspell hunspell-pt-br \
  && rm -rf /var/lib/apt/lists/*

# Gerador do Data Book (Python: ReportLab + pypdf + Pillow) em venv próprio; as fontes vão em backend/databook/assets.
COPY backend/databook/requirements.txt /tmp/databook-requirements.txt
RUN python3 -m venv /opt/databook-venv \
  && /opt/databook-venv/bin/pip install --no-cache-dir -r /tmp/databook-requirements.txt \
  && rm /tmp/databook-requirements.txt
ENV DATABOOK_PYTHON=/opt/databook-venv/bin/python

WORKDIR /workspace/backend

COPY backend/package*.json ./
COPY deploy/npm-ci.sh /usr/local/bin/filtrovali-npm-ci
RUN --mount=type=cache,id=filtrovali-backend-npm,target=/root/.npm,sharing=locked \
  sh /usr/local/bin/filtrovali-npm-ci

COPY backend/prisma.config.ts ./prisma.config.ts
COPY backend/prisma ./prisma
RUN npx prisma generate

COPY backend/src ./src
COPY backend/scripts ./scripts
COPY backend/data ./data
COPY backend/assets ./assets
COPY backend/databook/databook ./databook/databook
COPY backend/databook/assets ./databook/assets
COPY shared /workspace/shared
RUN mkdir -p /data/assets && cp -R ./assets/. /data/assets/
COPY Modelos /workspace/Modelos
COPY equipamentos /workspace/equipamentos

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
