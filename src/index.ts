import { CONSTANTS } from '@Config/constants'
import { measure } from './profiling'
import { Scoring } from './scoring'
import { Search } from './search'
import type { Payload } from './types'

const responses = [
  Response.json({ approved: true, fraud_score: 0 }),
  Response.json({ approved: true, fraud_score: 0.2 }),
  Response.json({ approved: true, fraud_score: 0.4 }),
  Response.json({ approved: false, fraud_score: 0.6 }),
  Response.json({ approved: false, fraud_score: 0.8 }),
  Response.json({ approved: false, fraud_score: 1 }),
]

Search.warmup(CONSTANTS.WARMUP)

const server = Bun.serve({
  port: CONSTANTS.PORT,
  routes: {
    '/ready': new Response('ok'),
    '/fraud-score': {
      async POST(req) {
        measure.begin('')

        const payload = (await measure('parse', () => req.json())) as Payload

        measure.identify(payload.id)

        const fraudCount = Scoring.fraudCount(payload)

        measure.finish()

        return responses[fraudCount]
      },
    },
  },
})

console.log(`listening on :${server.port}, n=${Search.size}`)
