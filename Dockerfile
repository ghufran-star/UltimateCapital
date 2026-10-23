# Railway builds this image. GitHub Actions builds the same image on every push.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=4096
COPY package.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM base
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "scripts/start.mjs"]
