export type RunHandle = {
  abort: () => void
}

export type RunResults = {
  workspace_dir: string
  files: string[]
  url: string
  pending?: boolean
}

export type UploadResult = {
  job_id: string
  input_dir: string
  output_dir: string
  files: string[]
}

export type RunCallbacks = {
  onLine: (line: string) => void
  onDone: (exitCode: number) => void
  onError: (message: string) => void
  onResults?: (results: RunResults) => void
}

export async function uploadFiles(files: File[]): Promise<UploadResult> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const resp = await fetch('/api/upload', { method: 'POST', body: form })
  if (!resp.ok) throw new Error(`Upload failed: HTTP ${resp.status}`)
  return resp.json()
}

export function runCommand(
  command: string,
  args: string[],
  cb: RunCallbacks,
  jobId?: string,
): RunHandle {
  return streamPost(`/api/run/${command}`, jobId ? { args, job_id: jobId } : { args }, cb)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function streamPost(path: string, body: unknown, cb: RunCallbacks): RunHandle {
  const ctrl = new AbortController()
  let runKey: string | null = null
  let linesReceived = 0
  let resultsSent = false
  let finished = false

  const finish = (code: number) => {
    if (finished) return
    finished = true
    cb.onDone(code)
  }

  // If the SSE connection drops (proxy timeout, network blip), the run keeps
  // going server-side — re-attach by polling its recorded state.
  const reattach = async () => {
    if (!runKey || finished) return false
    cb.onLine('— stream interrupted; re-attached to the run, it continues on the server —')
    for (let attempt = 0; attempt < 900 && !finished && !ctrl.signal.aborted; attempt++) {
      await sleep(4000)
      try {
        const resp = await fetch(`/api/run-state/${runKey}`)
        if (!resp.ok) continue
        const state = await resp.json()
        const lines: string[] = state.lines ?? []
        for (const line of lines.slice(linesReceived)) {
          cb.onLine(line)
          linesReceived++
        }
        if (state.results && !resultsSent) {
          resultsSent = true
          cb.onResults?.(state.results)
        }
        if (state.done) {
          finish(state.exit_code ?? -1)
          return true
        }
      } catch {
        /* transient; keep polling */
      }
    }
    return finished
  }

  ;(async () => {
    try {
      const resp = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => null)
        cb.onError(data?.error ?? `HTTP ${resp.status}`)
        finish(resp.status)
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
          const isResults = ev.startsWith('event: results')
          const isRun = ev.startsWith('event: run')
          const dataLine = ev.split('\n').find((l) => l.startsWith('data: '))
          const payload = dataLine ? dataLine.slice(6) : ''
          if (isRun) {
            runKey = payload || null
            continue
          }
          if (isResults) {
            try {
              resultsSent = true
              cb.onResults?.(JSON.parse(payload))
            } catch {
              /* ignore malformed results payload */
            }
            continue
          }
          if (isEnd) {
            finish(Number(payload))
            return
          }
          if (payload) {
            linesReceived++
            cb.onLine(payload)
          }
        }
      }
      // Stream ended without an `end` event — truncated by a proxy.
      if (!(await reattach())) finish(0)
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        finished = true
        return
      }
      if (!(await reattach())) {
        cb.onError((err as Error).message)
        finish(-1)
      }
    }
  })()
  return {
    abort: () => {
      finished = true
      ctrl.abort()
    },
  }
}
