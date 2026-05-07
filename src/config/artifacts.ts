import { CONSTANTS } from './constants'

const [vectorsBuffer, labelsBuffer, centroidsBuffer, offsetsBuffer] =
  await Promise.all([
    Bun.file(`${CONSTANTS.DATA_DIR}/vectors.bin`).arrayBuffer(),
    Bun.file(`${CONSTANTS.DATA_DIR}/labels.bin`).arrayBuffer(),
    Bun.file(`${CONSTANTS.DATA_DIR}/fine_centroids.bin`).arrayBuffer(),
    Bun.file(`${CONSTANTS.DATA_DIR}/fine_offsets.bin`).arrayBuffer(),
  ])

export const vectors = new Int16Array(vectorsBuffer)
export const labels = new Uint8Array(labelsBuffer)
export const fineCentroids = new Int16Array(centroidsBuffer)
export const fineOffsets = new Uint32Array(offsetsBuffer)
