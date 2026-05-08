import { mkdir } from 'node:fs/promises'
import { CONSTANTS, MCC_RISK, NORMALIZATION } from '@Config/constants'
import type { FineArtifacts } from './types'

export const PreprocessArtifacts = {
  async write(artifacts: FineArtifacts) {
    await mkdir(CONSTANTS.DATA_DIR, { recursive: true })

    await Bun.write(`${CONSTANTS.DATA_DIR}/vectors.bin`, artifacts.orderedVectors)
    await Bun.write(`${CONSTANTS.DATA_DIR}/fine_centroids.bin`, artifacts.fineCentroids)
    await Bun.write(`${CONSTANTS.DATA_DIR}/fine_bboxes.bin`, artifacts.fineBboxes)
    await Bun.write(`${CONSTANTS.DATA_DIR}/fine_offsets.bin`, artifacts.fineOffsets)
    await Bun.write(`${CONSTANTS.DATA_DIR}/fine_fraud_end.bin`, artifacts.fineFraudEnd)
    await Bun.write(`${CONSTANTS.DATA_DIR}/fine_radii.bin`, artifacts.fineRadii)
    await Bun.write(`${CONSTANTS.DATA_DIR}/pq_sub_centroids.bin`, artifacts.pqSubCentroids)
    await Bun.write(`${CONSTANTS.DATA_DIR}/pq_codes.bin`, artifacts.pqCodes)
    await Bun.write(
      `${CONSTANTS.DATA_DIR}/normalization.json`,
      JSON.stringify(NORMALIZATION)
    )
    await Bun.write(
      `${CONSTANTS.DATA_DIR}/mcc_risk.json`,
      JSON.stringify(Object.fromEntries(MCC_RISK))
    )
  },
}
