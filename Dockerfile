FROM oven/bun:1.3.13 AS builder
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY scripts/build.ts ./scripts/build.ts
RUN bun scripts/build.ts

FROM debian:bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
COPY out ./out
EXPOSE 9999

FROM base AS prod
COPY --from=builder /app/dist/server ./server
CMD ["./server"]

FROM base AS profile
COPY --from=builder /app/dist/server-profile ./server
CMD ["./server"]
