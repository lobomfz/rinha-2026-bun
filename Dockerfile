FROM oven/bun:1.3.13 AS builder
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
RUN bun build src/index.ts \
  --compile \
  --bytecode \
  --target=bun \
  --format=esm \
  --production \
  --sourcemap=none \
  --outfile=server

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/server ./server
COPY out ./out
EXPOSE 9999
CMD ["./server"]
