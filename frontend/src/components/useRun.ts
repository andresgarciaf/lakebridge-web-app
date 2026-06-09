import { useCallback, useRef, useState } from 'react'
import { runCommand } from '../runCommand'

export function useRun(command: string) {
  const [lines, setLines] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [exitCode, setExitCode] = useState<number | null>(null)
  const handleRef = useRef<{ abort: () => void } | null>(null)

  const start = useCallback(
    (args: string[]) => {
      if (running) return
      setLines([])
      setExitCode(null)
      setRunning(true)
      handleRef.current = runCommand(command, args, {
        onLine: (line) => setLines((prev) => [...prev, line]),
        onError: (msg) => setLines((prev) => [...prev, `Error: ${msg}`]),
        onDone: (code) => {
          setExitCode(code)
          setRunning(false)
        },
      })
    },
    [command, running],
  )

  const reset = useCallback(() => {
    handleRef.current?.abort()
    setLines([])
    setExitCode(null)
    setRunning(false)
  }, [])

  return { lines, running, exitCode, start, reset }
}
