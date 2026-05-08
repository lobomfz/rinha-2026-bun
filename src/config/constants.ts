export const CONSTANTS = {
  DIMS: 14,
  TOP_K: 5,
  FINE_COUNT: Number(process.env.FINE_COUNT) || 2048,
  FINE_PROBE: Number(process.env.FINE_PROBE) || 128,
  FAST_FINE_PROBE: Number(process.env.FAST_FINE_PROBE) || 8,
  PQ_M: 7,
  PQ_K: 256,
  PQ_SUB_DIM: 2,
  PQ_ITERS: 12,
  SCALE: 10000,
  PORT: 9999,
  SOCK_PATH: process.env.SOCK_PATH!,
  WARMUP: 2000,
  DATA_DIR: 'out',
}

export const NORMALIZATION = {
  max_amount: 10000,
  max_installments: 12,
  amount_vs_avg_ratio: 10,
  max_minutes: 1440,
  max_km: 1000,
  max_tx_count_24h: 20,
  max_merchant_avg_amount: 10000,
}

export const MCC_RISK = new Map([
  ['5411', 0.15],
  ['5812', 0.3],
  ['5912', 0.2],
  ['5944', 0.45],
  ['7801', 0.8],
  ['7802', 0.75],
  ['7995', 0.85],
  ['4511', 0.35],
  ['5311', 0.25],
  ['5999', 0.5],
])
