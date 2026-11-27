# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts vitest.config.ts index.html ./
COPY scripts ./scripts
COPY shared ./shared
COPY server ./server
COPY src ./src

RUN npm run build && npm prune --omit=dev

FROM gcr.io/distroless/nodejs22-debian12:nonroot

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001

COPY --chown=65532:65532 --from=builder /app/package.json ./package.json
COPY --chown=65532:65532 --from=builder /app/node_modules ./node_modules
COPY --chown=65532:65532 --from=builder /app/dist ./dist

USER 65532:65532

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "const p=process.env.PORT||3001;fetch('http://127.0.0.1:'+p+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["dist/server/index.js"]
