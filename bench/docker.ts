type DockerOpts = {
  profile?: boolean
}

type RunOpts = DockerOpts & {
  capture?: boolean
}

const composeFiles = (profile: boolean) =>
  profile
    ? ['-f', 'docker-compose.yml', '-f', 'docker-compose.profile.yml']
    : ['-f', 'docker-compose.yml']

async function compose(
  args: string[],
  { profile = false, capture = false }: RunOpts = {}
) {
  const proc = Bun.spawn(
    ['docker', 'compose', ...composeFiles(profile), ...args],
    {
      stdout: capture ? 'pipe' : 'inherit',
      stderr: 'inherit',
    }
  )

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

export const BenchDocker = {
  up({ profile = false }: DockerOpts = {}) {
    return compose(['up', '-d', '--build'], { profile })
  },

  stop({ profile = false }: DockerOpts = {}) {
    return compose(['stop'], { profile })
  },

  down({ profile = false }: DockerOpts = {}) {
    return compose(['down'], { profile })
  },

  profileLogs() {
    return compose(['logs', '--no-color', 'api1', 'api2'], {
      profile: true,
      capture: true,
    })
  },

  lbLogs() {
    return compose(['logs', '--no-color', 'lb'], {
      profile: true,
      capture: true,
    })
  },

  async waitUntilReady() {
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
  },
}
