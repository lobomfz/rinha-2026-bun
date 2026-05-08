import { CONSTANTS } from '@Config/constants'
import type { FineTraining } from './types'

export const PreprocessLayout = {
  fine(vectors: Int16Array, labels: Uint8Array, training: FineTraining) {
    const fineOffsets = new Uint32Array(CONSTANTS.FINE_COUNT + 1)

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      fineOffsets[fine + 1] = fineOffsets[fine] + training.fineCounts[fine]
    }

    const fineFraudEnd = new Uint32Array(CONSTANTS.FINE_COUNT)

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      fineFraudEnd[fine] = fineOffsets[fine] + training.fineFraudCounts[fine]
    }

    const fineCentroids = new Int16Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)
    const fineBboxes = new Int16Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS * 2)
    const orderedVectors = new Int16Array(vectors.length)
    const fraudCursors = new Uint32Array(fineOffsets)
    const legitCursors = new Uint32Array(fineFraudEnd)

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      const offset = fine * CONSTANTS.DIMS * 2

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        fineBboxes[offset + dim * 2] = 32767
        fineBboxes[offset + dim * 2 + 1] = -32768
      }
    }

    for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        fineCentroids[dim * CONSTANTS.FINE_COUNT + fine] = Math.round(
          training.centroidFloats[fine * CONSTANTS.DIMS + dim]
        )
      }
    }

    for (let i = 0; i < labels.length; i++) {
      const fine = training.assignments[i]
      const dst = labels[i] === 1 ? fraudCursors[fine]++ : legitCursors[fine]++

      const srcOffset = i * CONSTANTS.DIMS
      const dstOffset = dst * CONSTANTS.DIMS
      const bboxOffset = fine * CONSTANTS.DIMS * 2

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        const value = vectors[srcOffset + dim]
        const minOffset = bboxOffset + dim * 2
        const maxOffset = minOffset + 1

        orderedVectors[dstOffset + dim] = value

        if (value < fineBboxes[minOffset]) {
          fineBboxes[minOffset] = value
        }

        if (value > fineBboxes[maxOffset]) {
          fineBboxes[maxOffset] = value
        }
      }
    }

    return {
      orderedVectors,
      fineCentroids,
      fineBboxes,
      fineOffsets,
      fineFraudEnd,
    }
  },
}
