# ── Dockerfile para servir el export estático (PWA) ──
# NOTA: Para la APK usar build local: npm run build:cap  → genera out/ + cap sync

FROM node:22-bullseye AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=https://socialcircleinfo.cloud/api/v1
ARG NEXT_PUBLIC_WS_URL=https://socialcircleinfo.cloud
ENV NODE_ENV=production
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]