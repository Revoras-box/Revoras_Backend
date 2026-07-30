FROM node:20-alpine
WORKDIR /app

# Declared before anything runs, and baked into the image rather than left to the
# runtime to remember. This image installs production dependencies only, so it is
# a production artifact by construction - saying so here means the app's
# fail-closed guards (config/environment.js) are armed even if whoever runs the
# container passes no environment at all. It also wins over any .env that finds
# its way in, because dotenv never overwrites a variable that already exists.
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production
# .dockerignore keeps .env, .git and node_modules out of this layer - secrets are
# supplied at run time, never built into the image.
COPY . .

# Drop root. node:alpine ships an unprivileged `node` user; without this the app
# runs as uid 0, so any code-execution bug starts with full control of the
# container filesystem instead of none.
USER node

EXPOSE 5000
CMD ["node", "./src/server.js"]
