import { CONSTANTS } from './constants'

const [vectorsBuffer, labelsBuffer, centroidsBuffer, offsetsBuffer] =
  await Promise.all([
    Bun.file(`${CONSTANTS.DATA_DIR}/vectors.bin`).arrayBuffer(),
    Bun.file(`${CONSTANTS.DATA_DIR}/labels.bin`).arrayBuffer(),
    Bun.file(`${CONSTANTS.DATA_DIR}/region_centroids.bin`).arrayBuffer(),
    Bun.file(`${CONSTANTS.DATA_DIR}/region_offsets.bin`).arrayBuffer(),
  ])

export const vectors = new Int16Array(vectorsBuffer)
export const labels = new Uint8Array(labelsBuffer)
export const regionCentroids = new Int16Array(centroidsBuffer)
export const regionOffsets = new Uint32Array(offsetsBuffer)
