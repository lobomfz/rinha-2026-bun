import { mkdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { CONSTANTS, MCC_RISK, NORMALIZATION } from '@Config/constants'

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
  const ref = refs[i]!
  const offset = i * CONSTANTS.DIMS

  for (let dim = 0; dim < CONSTANTS.DIMS; dim++) {
    vectors[offset + dim] = Math.round(ref.vector[dim]! * CONSTANTS.SCALE)
  }

  if (ref.label === 'fraud') {
    labels[i] = 1
    fraudCount++
  }
}

await mkdir(CONSTANTS.DATA_DIR, { recursive: true })

await Bun.write(`${CONSTANTS.DATA_DIR}/vectors.bin`, vectors)
await Bun.write(`${CONSTANTS.DATA_DIR}/labels.bin`, labels)
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
  `wrote ${refs.length} vectors, fraud=${fraudCount}, dir=${CONSTANTS.DATA_DIR}, ${seconds}s`
)
