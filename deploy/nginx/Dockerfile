FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
ARG VITE_MAINTENANCE_MODE=false
ENV VITE_MAINTENANCE_MODE=$VITE_MAINTENANCE_MODE
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
COPY backend/assets /usr/share/nginx/html/assets
