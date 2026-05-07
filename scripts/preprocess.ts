import { mkdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { CONSTANTS, MCC_RISK, NORMALIZATION } from '@Config/constants'
import { KMeans } from './kmeans'

type Reference = {
  vector: number[]
  label: 'legit' | 'fraud'
}

const startedAt = Bun.nanoseconds()

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

console.log(
  `loaded ${refs.length} vectors, fraud=${fraudCount}, k=${CONSTANTS.FINE_COUNT}`
)

const centroidFloats = KMeans.train(vectors)
const assignments = KMeans.assign(vectors, centroidFloats)
const fineCounts = new Uint32Array(CONSTANTS.FINE_COUNT)
const centroidSums = new Float64Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)

for (let i = 0; i < assignments.length; i++) {
  const fine = assignments[i]
  const src = i * CONSTANTS.DIMS
  const dst = fine * CONSTANTS.DIMS

  fineCounts[fine]++

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    centroidSums[dst + dim] += vectors[src + dim]
  }
}

for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
  const count = fineCounts[fine]
  const offset = fine * CONSTANTS.DIMS

  if (count === 0) {
    continue
  }

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    centroidFloats[offset + dim] = centroidSums[offset + dim] / count
  }
}

const fineOffsets = new Uint32Array(CONSTANTS.FINE_COUNT + 1)

for (let fine = 0; fine < CONSTANTS.FINE_COUNT; fine++) {
  fineOffsets[fine + 1] = fineOffsets[fine] + fineCounts[fine]
}

const fineCentroids = new Int16Array(CONSTANTS.FINE_COUNT * CONSTANTS.DIMS)
const orderedVectors = new Int16Array(vectors.length)
const orderedLabels = new Uint8Array(labels.length)
const cursors = new Uint32Array(fineOffsets)

for (let i = 0; i < fineCentroids.length; i++) {
  fineCentroids[i] = Math.round(centroidFloats[i])
}

for (let i = 0; i < refs.length; i++) {
  const fine = assignments[i]
  const dst = cursors[fine]++
  const srcOffset = i * CONSTANTS.DIMS
  const dstOffset = dst * CONSTANTS.DIMS

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    orderedVectors[dstOffset + dim] = vectors[srcOffset + dim]
  }

  orderedLabels[dst] = labels[i]
}

await mkdir(CONSTANTS.DATA_DIR, { recursive: true })

await Bun.write(`${CONSTANTS.DATA_DIR}/vectors.bin`, orderedVectors)
await Bun.write(`${CONSTANTS.DATA_DIR}/labels.bin`, orderedLabels)
await Bun.write(`${CONSTANTS.DATA_DIR}/fine_centroids.bin`, fineCentroids)
await Bun.write(`${CONSTANTS.DATA_DIR}/fine_offsets.bin`, fineOffsets)
await Bun.write(
  `${CONSTANTS.DATA_DIR}/normalization.json`,
  JSON.stringify(NORMALIZATION)
)
await Bun.write(
  `${CONSTANTS.DATA_DIR}/mcc_risk.json`,
  JSON.stringify(Object.fromEntries(MCC_RISK))
)

const seconds = ((Bun.nanoseconds() - startedAt) / 1e9).toFixed(1)

console.log(
  `wrote ${refs.length} vectors, fraud=${fraudCount}, fine=${CONSTANTS.FINE_COUNT}, probe=${CONSTANTS.FINE_PROBE}, dir=${CONSTANTS.DATA_DIR}, ${seconds}s`
)
