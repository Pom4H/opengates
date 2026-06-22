# Open Gates review queue — advanced / self-host path.
#
# Dependency-free: no `npm install`, no build step. Node runs the TypeScript
# directly via built-in type stripping (Node >= 22.18). The image is just the
# Node base + the engine sources + the server entrypoint.

FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    QUEUE_FILE=/data/queue.json

WORKDIR /app

# Only what the runtime needs (the rest is excluded via .dockerignore).
COPY engine ./engine
COPY server.ts package.json ./

# The queue is one JSON file; persist it on a mounted volume.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.ts"]
