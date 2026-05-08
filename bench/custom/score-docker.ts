import fixtures from '../../data/test-data.json'
import { K6 } from '../k6'
import { ScoreSummary } from './summary'

type Fixtures = { stats: unknown }

const composeFiles = [
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.profile.yml',
]

async function compose(args: string[], capture = false) {
  const proc = Bun.spawn(['docker', 'compose', ...composeFiles, ...args], {
    stdout: capture ? 'pipe' : 'inherit',
    stderr: 'inherit',
  })

  let output = ''

  if (capture && proc.stdout instanceof ReadableStream) {
    output = await new Response(proc.stdout).text()
  }

  await proc.exited

  if (proc.exitCode !== 0) {
    throw new Error(
      `docker compose ${args.join(' ')} failed with exit ${proc.exitCode}`
    )
  }

  return output
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 120; attempt++) {
    const ready = await fetch('http://127.0.0.1:9999/ready')
      .then((response) => response.ok)
      .catch(() => false)

    if (ready) {
      return
    }

    await Bun.sleep(250)
  }

  throw new Error('server did not answer /ready in 30s')
}

await compose(['up', '-d', '--build'])

try {
  await waitUntilReady()

  const k6 = await K6.run({
    name: 'score-docker',
    script: 'bench/custom/test.js',
    resultsDir: 'bench/custom/results',
  })

  if (!k6.wroteSummary) {
    throw new Error('k6 did not write a summary')
  }

  const summary = await ScoreSummary.read(k6.resultPath)
  const result = ScoreSummary.analyze(summary)

  for (const line of ScoreSummary.format(
    result,
    (fixtures as Fixtures).stats,
    k6.resultPath
  )) {
    console.log(line)
  }

  await compose(['stop'])

  const logs = await compose(
    ['logs', '--no-color', 'api1', 'api2'],
    true
  )

  for (const line of logs.split('\n')) {
    if (line.includes('__profile__')) {
      console.log(line)
    }
  }

  if (k6.exitCode !== 0) {
    process.exitCode = k6.exitCode
  }

  if (ScoreSummary.failed(result)) {
    process.exitCode = 1
  }
} finally {
  await compose(['down'])
}
