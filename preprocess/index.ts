import { CONSTANTS } from '@Config/constants'
import { PreprocessArtifacts } from './artifacts'
import { PreprocessLayout } from './layout'
import { PreprocessLoad } from './load'
import { PreprocessTraining } from './training'

const startedAt = Bun.nanoseconds()

const loaded = await PreprocessLoad.references()

console.log(
  `loaded ${loaded.refs.length} vectors, fraud=${loaded.fraudCount}, k=${CONSTANTS.FINE_COUNT}`
)

const training = PreprocessTraining.fine(loaded.vectors, loaded.labels)

const artifacts = PreprocessLayout.fine(loaded.vectors, loaded.labels, training)

await PreprocessArtifacts.write(artifacts)

const seconds = ((Bun.nanoseconds() - startedAt) / 1e9).toFixed(1)

console.log(
  `wrote ${loaded.refs.length} vectors, fraud=${loaded.fraudCount}, fine=${CONSTANTS.FINE_COUNT}, probe=${CONSTANTS.FINE_PROBE}, dir=${CONSTANTS.DATA_DIR}, ${seconds}s`
)
