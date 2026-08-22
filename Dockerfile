# Glovels — one process, one disk, no build step.
#
# The application has no dependencies to install: it is Node's standard library
# and nothing else. So there is no npm install layer, no lockfile to go stale,
# and no supply chain to audit.
FROM node:22-slim

# Node 22 ships SQLite behind an experimental flag; the warning it prints on
# every start is noise in production logs, not a problem to solve.
ENV NODE_NO_WARNINGS=1
ENV GLOVELS_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/data

WORKDIR /app
COPY . /app

# The database and every uploaded passport scan live here. This MUST be a
# mounted volume — a container's own filesystem is thrown away on every deploy,
# and with it every student's file.
VOLUME ["/data"]

# Run as a non-root user. A web process that can rewrite its own code is a
# worse day than one that cannot.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 8080

# No shell, so signals reach Node directly and Control-C / SIGTERM actually
# stops it rather than orphaning the process.
CMD ["node", "serve.js"]
