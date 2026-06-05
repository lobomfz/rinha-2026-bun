declare module 'bun' {
  namespace fd {
    function serve<Data = undefined>(options: {
      unix: string
      socket: SocketHandler<Data>
    }): HandleServer

    function connect(options: {
      unix: string
      retry?: { intervalMs?: number; maxMs?: number }
      drain?(): void
      close?(): void
      error?(err: Error): void
    }): Promise<HandleChannel>
  }

  interface HandleServer {
    readonly unix: string
    close(): Promise<void>
    ref(): void
    unref(): void
  }

  interface HandleChannel {
    send(
      message: undefined,
      handle: Socket<unknown>,
      callback?: (err: Error | null) => void
    ): boolean
    close(): Promise<void>
    ref(): void
    unref(): void
  }
}

export {}
