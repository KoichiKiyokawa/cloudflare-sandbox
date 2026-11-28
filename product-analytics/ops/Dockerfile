FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@12.22.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY analysis ./analysis
COPY events ./events
COPY dashboard/query-endpoint.ts ./dashboard/
COPY ops/dashboard-query.ts ops/query-server.ts ./ops/
ENV PORT=8080 HOST=0.0.0.0 ANALYTICS_DUCKDB_THREADS=2 ANALYTICS_DUCKDB_MEMORY=5GB ANALYTICS_DUCKDB_TEMP=/tmp/analytics-duckdb ANALYTICS_DUCKDB_TEMP_LIMIT=6GB
USER node
EXPOSE 8080
CMD ["node", "ops/query-server.ts"]
