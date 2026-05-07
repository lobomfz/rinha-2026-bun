import { mkdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { CONSTANTS, MCC_RISK, NORMALIZATION } from '@Config/constants'

type Reference = {
  vector: number[]
  label: 'legit' | 'fraud'
}

function bucket(value: number, parts: number) {
  const scaled = Math.floor((value * parts) / CONSTANTS.SCALE)

  if (scaled < 0) {
    return 0
  }

  if (scaled >= parts) {
    return parts - 1
  }

  return scaled
}

const startedAt = Bun.nanoseconds()

const refs = JSON.parse(
  await Bun.file('data/references.json.gz')
    .arrayBuffer()
    .then((b) => gunzipSync(b).toString('utf-8'))
) as Reference[]

const vectors = new Int16Array(refs.length * CONSTANTS.DIMS)
const labels = new Uint8Array(refs.length)
const regions = new Uint16Array(refs.length)
const regionCounts = new Uint32Array(CONSTANTS.REGION_COUNT)
const centroidSums = new Float64Array(CONSTANTS.REGION_COUNT * CONSTANTS.DIMS)

let fraudCount = 0

for (let i = 0; i < refs.length; i++) {
  const ref = refs[i]
  const offset = i * CONSTANTS.DIMS

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    vectors[offset + dim] = Math.round(ref.vector[dim] * CONSTANTS.SCALE)
  }

  const amount = bucket(vectors[offset], 8)
  const installments = bucket(vectors[offset + 1], 4)
  const kmFromHome = bucket(vectors[offset + 7], 4)
  const txCount = bucket(vectors[offset + 8], 4)
  const merchantRisk = bucket(vectors[offset + 12], 4)
  const region =
    (((amount * 4 + installments) * 4 + kmFromHome) * 4 + txCount) * 4 +
    merchantRisk

  regions[i] = region
  regionCounts[region]++

  const centroidOffset = region * CONSTANTS.DIMS

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    centroidSums[centroidOffset + dim] += vectors[offset + dim]
  }

  if (ref.label === 'fraud') {
    labels[i] = 1
    fraudCount++
  }
}

const regionOffsets = new Uint32Array(CONSTANTS.REGION_COUNT + 1)

for (let region = 0; region < CONSTANTS.REGION_COUNT; region++) {
  regionOffsets[region + 1] = regionOffsets[region] + regionCounts[region]
}

const regionCentroids = new Int16Array(CONSTANTS.REGION_COUNT * CONSTANTS.DIMS)

for (let region = 0; region < CONSTANTS.REGION_COUNT; region++) {
  const count = regionCounts[region]
  const offset = region * CONSTANTS.DIMS

  if (count === 0) {
    for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
      regionCentroids[offset + dim] = 32767
    }

    continue
  }

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    regionCentroids[offset + dim] = Math.round(centroidSums[offset + dim] / count)
  }
}

const orderedVectors = new Int16Array(vectors.length)
const orderedLabels = new Uint8Array(labels.length)
const cursors = new Uint32Array(regionOffsets)

for (let i = 0; i < refs.length; i++) {
  const region = regions[i]
  const dst = cursors[region]++
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
await Bun.write(`${CONSTANTS.DATA_DIR}/region_centroids.bin`, regionCentroids)
await Bun.write(`${CONSTANTS.DATA_DIR}/region_offsets.bin`, regionOffsets)
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
  `wrote ${refs.length} vectors, fraud=${fraudCount}, regions=${CONSTANTS.REGION_COUNT}, dir=${CONSTANTS.DATA_DIR}, ${seconds}s`
)
