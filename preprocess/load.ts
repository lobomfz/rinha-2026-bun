import { gunzipSync } from 'node:zlib'
import { CONSTANTS } from '@Config/constants'
import type { Reference } from './types'

export const PreprocessLoad = {
  async references() {
    const refs = JSON.parse(
      await Bun.file('data/references.json.gz')
        .arrayBuffer()
        .then((b) => gunzipSync(b).toString('utf-8'))
    ) as Reference[]

    const vectors = new Int16Array(refs.length * CONSTANTS.DIMS)
    const labels = new Uint8Array(refs.length)

    let fraudCount = 0

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i]
      const offset = i * CONSTANTS.DIMS

      for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
        vectors[offset + dim] = Math.round(ref.vector[dim] * CONSTANTS.SCALE)
      }

      if (ref.label === 'fraud') {
        labels[i] = 1
        fraudCount++
      }
    }

    return { refs, vectors, labels, fraudCount }
  },
}
