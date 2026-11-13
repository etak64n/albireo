# syntax=docker/dockerfile:1

# The browser app. It is the same JavaScript on every platform, so it builds once, on the
# platform of the builder, and goes into the image of each platform as it is.
FROM --platform=$BUILDPLATFORM node:24-slim AS app
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')" \
 && pnpm install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY public/ public/
COPY themes/ themes/
COPY shared/ shared/
COPY src/ src/
RUN pnpm exec vite build

# The server, built on the platform of the image. The dependencies build first, in a layer of
# their own, so that a change of albireo alone does not build them again.
FROM rust:1.100.0-slim-trixie AS server
WORKDIR /src/server
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src \
 && echo "fn main() {}" > src/main.rs \
 && touch src/lib.rs \
 && cargo build --release --locked \
 && rm -rf src
# The migrations and the security headers go into the program as it builds.
COPY migrations/ /src/migrations/
COPY shared/security-headers.json /src/shared/
COPY server/src/ src/
# COPY keeps the times of the files, which can be older than the build of the dependencies.
RUN touch src/main.rs src/lib.rs \
 && cargo build --release --locked

FROM debian:trixie-slim
LABEL org.opencontainers.image.title="albireo" \
      org.opencontainers.image.description="A private video library for a team, with videos in S3-compatible storage" \
      org.opencontainers.image.source="https://github.com/etak64n/albireo" \
      org.opencontainers.image.licenses="MIT"
# albireo checks the certificate of the bucket with the certificates of Debian.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --no-create-home --shell /usr/sbin/nologin albireo
WORKDIR /app
COPY --from=server /src/server/target/release/albireo /usr/local/bin/albireo
COPY --from=app /src/dist/ dist/
USER albireo
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["albireo", "healthcheck"]
CMD ["albireo", "serve"]
