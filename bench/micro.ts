import fixtures from '../data/test-data.json'
import { bench, run } from 'mitata'
import { CONSTANTS } from '@Config/constants'
import { Scoring } from '../src/scoring'
import { Search } from '../src/search'
import type { Payload } from '../src/types'
import { Vectorize } from '../src/vectorize'

type Entry = { request: Payload }
type Fixtures = { entries: Entry[] }

const payload = (fixtures as Fixtures).entries[0].request
const vector = new Float32Array(CONSTANTS.DIMS)
const query = new Int16Array(CONSTANTS.DIMS)

Vectorize.transform(payload, vector)
Scoring.quantize(vector, query)

bench('vectorize', () => {
  Vectorize.transform(payload, vector)
})

bench('quantize', () => {
  Scoring.quantize(vector, query)
})

bench('selectFine', () => {
  Search.selectFine(query)
})

bench('bboxLowerBound', () => {
  Search.bboxLowerBound(query, 0)
})

bench('knn', () => {
  Search.knn(query)
})

await run()
