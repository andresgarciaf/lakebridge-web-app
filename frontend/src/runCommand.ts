export type RunHandle = {
  abort: () => void
}

export type RunResults = {
  workspace_dir: string
  files: string[]
  url: string
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
  const ctrl = new AbortController()
  ;(async () => {
    try {
      const resp = await fetch(`/api/run/${command}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobId ? { args, job_id: jobId } : { args }),
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
          const isResults = ev.startsWith('event: results')
          const dataLine = ev.split('\n').find((l) => l.startsWith('data: '))
          const payload = dataLine ? dataLine.slice(6) : ''
          if (isResults) {
            try {
              cb.onResults?.(JSON.parse(payload))
            } catch {
              /* ignore malformed results payload */
            }
            continue
          }
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
