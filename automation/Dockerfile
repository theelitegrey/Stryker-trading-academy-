# Build from the repository root so the shared card renderer can be copied in:
#   docker build -f automation/Dockerfile -t stryker-social .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY automation/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY automation/src ./src
COPY automation/scripts ./scripts
COPY automation/fonts ./fonts
COPY functions-src/xAutopost-cards.js ./vendor/xAutopost-cards.js
COPY functions-src/fonts ./vendor/fonts
COPY assets/chapters-data.js ../assets/chapters-data.js
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=5m --timeout=10s CMD node -e "fetch('http://localhost:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
