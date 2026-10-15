# syntax=docker/dockerfile:1
# The hosted Dockcrate site. Built and pushed to Vercel Container Registry by .github/workflows/deploy.yml.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx next build

FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /app
# A public server has no project folders of the user's: hosted mode refuses browsing and writing the disk.
# Next reads PORT; set it to what the platform sends traffic to.
ENV NODE_ENV=production DOCKCRATE_HOSTED=1 NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY package.json next.config.mjs ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0"]
