import fixtures from '../data/test-data.json'
import { Scoring } from '../src/scoring'
import type { Payload } from '../src/types'

type Entry = {
  request: Payload
  expected_approved: boolean
  expected_fraud_score: number
}

type Fixtures = { entries: Entry[] }

const entries = (fixtures as Fixtures).entries.slice(0, 1000)

let falsePositives = 0
let falseNegatives = 0
let scoreMismatches = 0

for (const entry of entries) {
  const fraudCount = Scoring.fraudCount(entry.request)
  const approved = fraudCount < 3
  const expectedCount = Math.round(entry.expected_fraud_score * 5)

  if (approved !== entry.expected_approved) {
    if (approved) {
      falseNegatives++
    } else {
      falsePositives++
    }
  }

  if (fraudCount !== expectedCount) {
    scoreMismatches++
  }
}

console.log(
  `checked=${entries.length} fp=${falsePositives} fn=${falseNegatives} score_mismatch=${scoreMismatches}`
)

if (falsePositives > 0 || falseNegatives > 0 || scoreMismatches > 0) {
  process.exit(1)
}
