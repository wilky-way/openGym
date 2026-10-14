# Root workspace context, restricted by .dockerignore / scripts/check-docker.
FROM oven/bun:1.4.1@sha256:9e123d5fc069e29d519fd4c981afb61b8542ac80274771961136db1e4538d53e AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ ./packages/
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun build --compile --minify --sourcemap=none --no-compile-autoload-dotenv --no-compile-autoload-bunfig packages/server/src/cli/serve.ts --outfile /app/opengym-server

FROM oven/bun:1.4.1@sha256:9e123d5fc069e29d519fd4c981afb61b8542ac80274771961136db1e4538d53e
WORKDIR /app
COPY --from=build --chown=bun:bun /app/opengym-server ./opengym-server
RUN mkdir -p /data && chown bun:bun /data
USER bun
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data DEVICE_TOKENS=1
EXPOSE 3000
CMD ["/app/opengym-server"]
HEALTHCHECK --interval=5m --timeout=5s --retries=3 CMD bun -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
