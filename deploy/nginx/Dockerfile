FROM node:24-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
COPY deploy/npm-ci.sh /usr/local/bin/filtrovali-npm-ci
RUN --mount=type=cache,id=filtrovali-frontend-npm,target=/root/.npm,sharing=locked \
  sh /usr/local/bin/filtrovali-npm-ci

COPY frontend/ ./
COPY shared /app/shared
ARG VITE_MAINTENANCE_MODE=false
ARG VITE_ERROR_TRACKING_ENABLED=false
ARG VITE_ERROR_TRACKING_ENDPOINT=
ENV VITE_MAINTENANCE_MODE=$VITE_MAINTENANCE_MODE
ENV VITE_ERROR_TRACKING_ENABLED=$VITE_ERROR_TRACKING_ENABLED
ENV VITE_ERROR_TRACKING_ENDPOINT=$VITE_ERROR_TRACKING_ENDPOINT
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY backend/assets /usr/share/nginx/html/assets
