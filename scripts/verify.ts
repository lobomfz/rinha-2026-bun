import fixtures from '../data/test-data.json'
import { Scoring } from '../src/scoring'

let falsePositives = 0
let falseNegatives = 0
let scoreMismatches = 0

for (const entry of fixtures.entries) {
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
  `checked=${fixtures.entries.length} fp=${falsePositives} fn=${falseNegatives} score_mismatch=${scoreMismatches}`
)

if (falsePositives > 0 || falseNegatives > 0 || scoreMismatches >= 10) {
  process.exit(1)
}
