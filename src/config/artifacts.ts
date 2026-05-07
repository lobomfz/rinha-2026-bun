import { CONSTANTS } from './constants'

const [vectorsBuffer, labelsBuffer] = await Promise.all([
  Bun.file(`${CONSTANTS.DATA_DIR}/vectors.bin`).arrayBuffer(),
  Bun.file(`${CONSTANTS.DATA_DIR}/labels.bin`).arrayBuffer(),
])

export const vectors = new Int16Array(vectorsBuffer)
export const labels = new Uint8Array(labelsBuffer)
