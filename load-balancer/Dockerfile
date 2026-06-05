ARG BUN_RUNTIME_IMAGE=bun-rinha-runtime:latest

FROM ${BUN_RUNTIME_IMAGE} AS prod
WORKDIR /app
COPY index.ts ./index.ts
ENTRYPOINT ["/usr/local/bin/bun", "run", "index.ts"]
