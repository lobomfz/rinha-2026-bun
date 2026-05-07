import { CONSTANTS } from '@Config/constants'
import { Search } from './search'
import type { Payload } from './types'
import { Vectorize } from './vectorize'

const vector = new Float32Array(CONSTANTS.DIMS)
const query = new Int16Array(CONSTANTS.DIMS)

export const Scoring = {
  quantize(src: Float32Array, out: Int16Array): void {
    for (let i = 0; i < CONSTANTS.DIMS; i++) {
      out[i] = Math.round(src[i]! * CONSTANTS.SCALE)
    }
  },

  fraudCount(payload: Payload) {
    Vectorize.transform(payload, vector)

    this.quantize(vector, query)

    return Search.knn(query)
  },
}
