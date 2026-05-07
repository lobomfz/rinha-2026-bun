import { MCC_RISK, NORMALIZATION } from '@Config/constants'
import type { Payload } from './types'

export const Vectorize = {
  clamp01(value: number): number {
    if (value < 0) {
      return 0
    }

    if (value > 1) {
      return 1
    }

    return value
  },

  digitAt(value: string, index: number): number {
    return value.codePointAt(index)! - 48
  },

  parseIsoMs(value: string): number {
    const year =
      Vectorize.digitAt(value, 0) * 1000 +
      Vectorize.digitAt(value, 1) * 100 +
      Vectorize.digitAt(value, 2) * 10 +
      Vectorize.digitAt(value, 3)

    const month =
      Vectorize.digitAt(value, 5) * 10 + Vectorize.digitAt(value, 6) - 1

    const day = Vectorize.digitAt(value, 8) * 10 + Vectorize.digitAt(value, 9)

    const hour =
      Vectorize.digitAt(value, 11) * 10 + Vectorize.digitAt(value, 12)

    const minute =
      Vectorize.digitAt(value, 14) * 10 + Vectorize.digitAt(value, 15)

    const second =
      Vectorize.digitAt(value, 17) * 10 + Vectorize.digitAt(value, 18)

    return Date.UTC(year, month, day, hour, minute, second)
  },

  transform(payload: Payload, out: Float32Array): void {
    const tx = payload.transaction

    const requestedMs = Vectorize.parseIsoMs(tx.requested_at)

    const hour =
      Vectorize.digitAt(tx.requested_at, 11) * 10 +
      Vectorize.digitAt(tx.requested_at, 12)

    const dayOfWeek = (Math.floor(requestedMs / 86400000) + 3) % 7

    out[0] = Vectorize.clamp01(tx.amount / NORMALIZATION.max_amount)
    out[1] = Vectorize.clamp01(tx.installments / NORMALIZATION.max_installments)
    out[2] = Vectorize.clamp01(
      tx.amount /
        payload.customer.avg_amount /
        NORMALIZATION.amount_vs_avg_ratio
    )
    out[3] = hour / 23
    out[4] = dayOfWeek / 6

    if (payload.last_transaction === null) {
      out[5] = -1
      out[6] = -1
    } else {
      const lastMs = Vectorize.parseIsoMs(payload.last_transaction.timestamp)
      out[5] = Vectorize.clamp01(
        (requestedMs - lastMs) / 60000 / NORMALIZATION.max_minutes
      )
      out[6] = Vectorize.clamp01(
        payload.last_transaction.km_from_current / NORMALIZATION.max_km
      )
    }

    out[7] = Vectorize.clamp01(
      payload.terminal.km_from_home / NORMALIZATION.max_km
    )
    out[8] = Vectorize.clamp01(
      payload.customer.tx_count_24h / NORMALIZATION.max_tx_count_24h
    )
    out[9] = payload.terminal.is_online ? 1 : 0
    out[10] = payload.terminal.card_present ? 1 : 0
    out[11] = payload.customer.known_merchants.includes(payload.merchant.id)
      ? 0
      : 1
    out[12] = MCC_RISK.get(payload.merchant.mcc)! || 0.5
    out[13] = Vectorize.clamp01(
      payload.merchant.avg_amount / NORMALIZATION.max_merchant_avg_amount
    )
  },
}
