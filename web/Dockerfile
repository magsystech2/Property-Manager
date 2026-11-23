# Project Ledger web app: static files served by nginx.
# The browser talks to Supabase directly (same as the iPhone app), so this container
# holds no secrets and no database. Live sync settings are read from the environment
# at startup, so one image works for any Supabase project.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm test && npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.d/40-ledger-config.sh
RUN chmod +x /docker-entrypoint.d/40-ledger-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
