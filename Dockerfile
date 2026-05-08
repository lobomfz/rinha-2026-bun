FROM oven/bun:1.3.13 AS builder
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY scripts/build.ts ./scripts/build.ts
RUN bun scripts/build.ts

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/dist/server ./server
COPY out ./out
EXPOSE 9999
CMD ["./server"]
