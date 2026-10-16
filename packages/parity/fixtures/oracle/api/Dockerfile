FROM oven/bun:1.4.1-alpine AS default
USER root

# Image metadata and healthcheck for the Bun runtime.
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="wilky-way" \
    org.opencontainers.image.title="opengym-api" \
    org.opencontainers.image.description="Backend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://github.com/wilky-way/openGym" \
    org.opencontainers.image.url="https://github.com/wilky-way/openGym" \
    org.opencontainers.image.documentation="https://github.com/wilky-way/openGym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

WORKDIR /app

# Keep the image's Alpine packages current.
RUN apk upgrade --no-cache

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Every module server.js imports from the api root has to be named here: the image carries nothing
# else, and one that is missing only shows at boot, as ERR_MODULE_NOT_FOUND.
COPY server.js push-messages.js nudge.js nudge-copy.js verify-error.js password.js rate-limit.js passkeys-store.js device-link.js media.js queue.js sync-stamps.js programme-sync.js programme-prescription.js programme-calendar.js durable.js ./
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "server.js"]

HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
