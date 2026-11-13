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
RUN pnpm exec vite build \
 && mkdir /data

# The dependencies of the server, which are JavaScript too, in a plain node_modules.
FROM --platform=$BUILDPLATFORM node:24-slim AS server-dependencies
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')" \
 && echo "nodeLinker: hoisted" >> pnpm-workspace.yaml \
 && pnpm install --prod --frozen-lockfile

# Node.js runs the TypeScript of the server as it is, and keeps the database with node:sqlite.
FROM node:24-slim
LABEL org.opencontainers.image.title="albireo" \
      org.opencontainers.image.description="A private video library in one Docker container, with videos in S3-compatible storage" \
      org.opencontainers.image.source="https://github.com/etak64n/albireo" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=server-dependencies /src/node_modules/ node_modules/
COPY --from=app /src/dist/ dist/
COPY --from=app --chown=node:node /data /data
COPY package.json ./
COPY migrations/ migrations/
COPY shared/ shared/
COPY server/ server/
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The warnings say that type stripping and node:sqlite are still experimental in Node.js 24.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]
