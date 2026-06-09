import { useCallback, useRef, useState } from 'react'
import { runCommand, type RunResults } from '../runCommand'

export function useRun(command: string) {
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [results, setResults] = useState<RunResults | null>(null)
  const handleRef = useRef<{ abort: () => void } | null>(null)

  const start = useCallback(
    (args: string[], jobId?: string) => {
      if (running) return
      setLines([])
      setExitCode(null)
      setResults(null)
      setRunning(true)
      handleRef.current = runCommand(
        command,
        args,
        {
          onLine: (line) => setLines((prev) => [...prev, line]),
          onError: (msg) => setLines((prev) => [...prev, `Error: ${msg}`]),
          onResults: setResults,
          onDone: (code) => {
            setExitCode(code)
            setRunning(false)
          },
        },
        jobId,
      )
    },
    [command, running],
  )

  const reset = useCallback(() => {
    handleRef.current?.abort()
    setLines([])
    setExitCode(null)
    setResults(null)
    setRunning(false)
  }, [])

  return { lines, running, exitCode, results, start, reset }
}
