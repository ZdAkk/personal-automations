# Wohnung dashboard — LAN-only web UI for drafting apartment application letters.
#
# Built from the REPO ROOT, not from dashboard/, because the server imports the
# shared drafting library from ../src. Build with:
#   docker compose -f dashboard/docker-compose.yml up --build -d
FROM node:22-slim

WORKDIR /app

# Install workspace deps first so a source-only change doesn't refetch them.
COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/
RUN npm ci

# The shared drafting library + config, then the dashboard itself.
COPY src ./src
COPY dashboard ./dashboard

# Build the React bundle; the server serves dashboard/web/dist statically.
RUN npm run build -w wohnung-dashboard

ENV NODE_ENV=production
ENV DASHBOARD_PORT=8088
ENV DASHBOARD_HOST=0.0.0.0
EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8088/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start", "-w", "wohnung-dashboard"]
