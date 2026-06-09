export type RunHandle = {
  abort: () => void
}

export type RunCallbacks = {
  onLine: (line: string) => void
  onDone: (exitCode: number) => void
  onError: (message: string) => void
}

export function runCommand(command: string, args: string[], cb: RunCallbacks): RunHandle {
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const resp = await fetch(`/api/run/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ args }),
        signal: ctrl.signal,
      })
      if (!resp.ok || !resp.body) {
        cb.onError(`HTTP ${resp.status}`)
        cb.onDone(resp.status)
        return
      }
      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''
        for (const ev of events) {
          const isEnd = ev.startsWith('event: end')
          const dataLine = ev.split('\n').find((l) => l.startsWith('data: '))
          const payload = dataLine ? dataLine.slice(6) : ''
          if (isEnd) {
            cb.onDone(Number(payload))
            return
          }
          if (payload) cb.onLine(payload)
        }
      }
      cb.onDone(0)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') cb.onError((err as Error).message)
      cb.onDone(-1)
    }
  })()
  return { abort: () => ctrl.abort() }
}
