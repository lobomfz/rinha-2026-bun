import { CONSTANTS } from './constants'

const [
  vectorsBuffer,
  centroidsBuffer,
  bboxesBuffer,
  offsetsBuffer,
  fraudEndBuffer,
] = await Promise.all([
  Bun.file(`${CONSTANTS.DATA_DIR}/vectors.bin`).arrayBuffer(),
  Bun.file(`${CONSTANTS.DATA_DIR}/fine_centroids.bin`).arrayBuffer(),
  Bun.file(`${CONSTANTS.DATA_DIR}/fine_bboxes.bin`).arrayBuffer(),
  Bun.file(`${CONSTANTS.DATA_DIR}/fine_offsets.bin`).arrayBuffer(),
  Bun.file(`${CONSTANTS.DATA_DIR}/fine_fraud_end.bin`).arrayBuffer(),
])

export const vectors = new Int16Array(vectorsBuffer)
export const fineCentroids = new Int16Array(centroidsBuffer)
export const fineBboxes = new Int16Array(bboxesBuffer)
export const fineOffsets = new Uint32Array(offsetsBuffer)
export const fineFraudEnd = new Uint32Array(fraudEndBuffer)
