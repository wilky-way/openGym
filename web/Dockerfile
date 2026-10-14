# Consume the prepared public web build supplied through --web-dist.
FROM nginxinc/nginx-unprivileged:alpine@sha256:884e0b7f42f303641b0f4e78755aea647521dca0b89ca3be7992ad78b5c07434
# Same reason as in api/Dockerfile: alpine fixes land faster than the nginx image is rebuilt.
# The base's last instruction is USER 101, and apk then exits 99 — it cannot open its log as
# that user. Upgrade as root, then switch back. 101 has to be the last USER in this file so
# the entrypoint and the nginx master both stay uid 101. It can bind port 80 under Docker,
# which sets net.ipv4.ip_unprivileged_port_start=0; the base image's EXPOSE 8080 is metadata,
# and nothing here listens on it. Another runtime (most Kubernetes ones, Podman rootless)
# needs NGINX_PORT=1024 or higher, or that sysctl; configure NGINX_PORT for that runtime.
#
# An upgrade can put the packaged nginx.conf back (a `user` directive, pid under /run) and
# recreate /var/cache/nginx as root, which is the mkdir a non-root master dies on. Restore
# the layout the base established, still as root, and idempotently: drop a user directive
# if one is present, point pid at /tmp/nginx.pid, and insert the /tmp temp paths only when
# client_body_temp_path is absent — a second insert duplicates them and nginx refuses the
# config. chown/chmod cover /var/cache/nginx and /etc/nginx only, so uid 101 can render the
# template. The static tree keeps the default modes; uid 101 only reads it.
USER root
RUN apk upgrade --no-cache \
 && sed -i '/^[[:space:]]*user[[:space:]]/d' /etc/nginx/nginx.conf \
 && sed -i 's,\(/var\)\{0\,1\}/run/nginx.pid,/tmp/nginx.pid,' /etc/nginx/nginx.conf \
 && if ! grep -q 'client_body_temp_path' /etc/nginx/nginx.conf; then \
      sed -i "/^http {/a \    proxy_temp_path /tmp/proxy_temp;\n    client_body_temp_path /tmp/client_temp;\n    fastcgi_temp_path /tmp/fastcgi_temp;\n    uwsgi_temp_path /tmp/uwsgi_temp;\n    scgi_temp_path /tmp/scgi_temp;\n" /etc/nginx/nginx.conf; \
    fi \
 && chown -R nginx:root /var/cache/nginx /etc/nginx \
 && chmod -R g+w /var/cache/nginx /etc/nginx \
 && grep -Eq '^[[:space:]]*pid[[:space:]]+/tmp/nginx\.pid;' /etc/nginx/nginx.conf \
 && ! grep -Eq '^[[:space:]]*user[[:space:]]' /etc/nginx/nginx.conf
USER 101
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="the operator" \
    org.opencontainers.image.title="opengym-web" \
    org.opencontainers.image.description="Frontend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://github.com/wilky-way/openGym" \
    org.opencontainers.image.url="https://github.com/wilky-way/openGym" \
    org.opencontainers.image.documentation="https://github.com/wilky-way/openGym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
# Stops the container at start-up on a BASE_PATH the config cannot serve ("/gym/", "gym"), instead
# of a server that 404s under the prefix. nginx's entrypoint runs these scripts in order; 05 is
# before the template rendering at 20.
COPY --chmod=755 web/05-check-base-path.sh /docker-entrypoint.d/
ARG WEB_DIST=dist
COPY ${WEB_DIST}/ /usr/share/nginx/html/
# The exercise stills and animations, 180 px, licensed from Gym visual for openGym only: see
# catalogue/media/NOTICE.md. They ship inside the image; nothing is downloaded at start-up.
COPY catalogue/media/ /usr/share/nginx/html/exercise-media/

# Set Default ENVs for nginx
ENV NGINX_PORT=80
ENV BACKEND=api
ENV PORT=3000
# The DNS nginx asks about BACKEND on every /api request. Docker's embedded resolver by
# default, which is correct for compose. Nothing listens on it elsewhere, and an unreachable
# resolver makes every /api request hang rather than fail, so any other runtime has to say
# what its DNS is: on Kubernetes, the kube-dns/CoreDNS service address (commonly 10.96.0.10).
ENV RESOLVER=127.0.0.11
# Empty = the CF-Connecting-IP header is dropped before it reaches the API, so it cannot be
# forged by a direct client. Set to $http_cf_connecting_ip only when Cloudflare is really in
# front. Defined here too, not just in compose, so the template always renders for anyone
# running the prebuilt image from their own compose file.
ENV CF_CONNECTING_IP=""
# Subpath deployments behind a reverse proxy that does NOT strip its prefix: "/gym", no trailing
# slash. Empty (the default) serves the app at the root exactly as before. A proxy that strips
# the prefix needs nothing here — the app derives the API address from its own URL.
ENV BASE_PATH=""
# Probe the port nginx was actually told to listen on (NGINX_PORT is configurable, so a
# hardcoded http://localhost/ breaks on any instance that changed it), and address it as
# 127.0.0.1: envsubst rewrites the conf after the image's IPv6 script, so nginx ends up
# listening on IPv4 only while "localhost" resolves to ::1 first.
HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${NGINX_PORT}/" || exit 1

