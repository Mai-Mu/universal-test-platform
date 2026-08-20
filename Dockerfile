FROM public.ecr.aws/docker/library/node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    TZ=Asia/Shanghai

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node public ./public
COPY --chown=node:node src ./src

RUN mkdir -p /app/data \
    && chown -R node:node /app/data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/projects').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "src/server.js"]
