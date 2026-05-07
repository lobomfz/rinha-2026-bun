import { SharedArray } from 'k6/data'
import exec from 'k6/execution'
import http from 'k6/http'
import { Counter } from 'k6/metrics'

const entries = new SharedArray('entries', () => {
  return JSON.parse(open('../../data/test-data.json')).entries
})

const falsePositives = new Counter('false_positives')
const falseNegatives = new Counter('false_negatives')
const truePositives = new Counter('true_positives')
const trueNegatives = new Counter('true_negatives')
const httpErrors = new Counter('http_errors')
const scoreMismatches = new Counter('score_mismatches')

export const options = {
  summaryTrendStats: ['p(50)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    score: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 300,
      stages: [{ duration: '120s', target: 900 }],
      gracefulStop: '10s',
    },
  },
  thresholds: {
    false_positives: ['count==0'],
    false_negatives: ['count==0'],
    http_errors: ['count==0'],
    score_mismatches: ['count==0'],
  },
}

export default function () {
  const entry = entries[exec.scenario.iterationInTest]

  if (!entry) {
    return
  }

  const response = http.post(
    'http://127.0.0.1:9999/fraud-score',
    JSON.stringify(entry.request),
    {
      headers: { 'content-type': 'application/json' },
      timeout: '2001ms',
    }
  )

  if (response.status !== 200) {
    httpErrors.add(1)
    return
  }

  const body = JSON.parse(response.body)

  if (body.approved === entry.expected_approved) {
    if (body.approved) {
      trueNegatives.add(1)
    } else {
      truePositives.add(1)
    }
  } else if (body.approved) {
    falseNegatives.add(1)
  } else {
    falsePositives.add(1)
  }

  if (
    Math.round(body.fraud_score * 5) !==
    Math.round(entry.expected_fraud_score * 5)
  ) {
    scoreMismatches.add(1)
  }
}
