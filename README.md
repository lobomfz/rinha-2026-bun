# rinha-de-backend-2026

submissão para a [rinha-de-backend-2026](https://github.com/zanfranceschi/rinha-de-backend-2026).

detector de fraude em bun + typescript puro, sem ffi.

- ivf-pq, fast path (8 probes) + refine sob demanda
- int16 + scan com early-exit por dimensão
- zero-alloc no hot path
- profiling inline via codegen, zero overhead em prod
- parser http manual sobre unix socket

load balancer em C pq haproxy não dá conta, idealmente seria bun com `reuseport`
