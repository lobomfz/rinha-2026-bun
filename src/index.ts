import { CONSTANTS } from '@Config/constants'
import { Scoring } from './scoring'
import { Search } from './search'
import type { Payload } from './types'

const server = Bun.serve({
  port: CONSTANTS.PORT,
  routes: {
    '/ready': new Response('ok'),
    '/fraud-score': {
      async POST(req) {
        const payload = (await req.json()) as Payload

        const fraudCount = Scoring.fraudCount(payload)

        return Response.json({
          approved: fraudCount < 3,
          fraud_score: fraudCount / CONSTANTS.TOP_K,
        })
      },
    },
  },
})

console.log(`listening on :${server.port}, n=${Search.size}`)
