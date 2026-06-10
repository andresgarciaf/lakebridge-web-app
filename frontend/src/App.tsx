import { useCallback, useEffect, useState } from 'react'
import { Layout } from './components/Layout'
import { SetupScreen } from './components/SetupScreen'
import { HomeView } from './components/views/HomeView'
import { ProfilerView } from './components/views/ProfilerView'
import { AnalyzerView } from './components/views/AnalyzerView'
import { ConverterView } from './components/views/ConverterView'
import { ReconcileView } from './components/views/ReconcileView'
import type { EnvInfo, UcStatus, View } from './types'

type Status = 'pending' | 'running' | 'ready' | 'error'

type StatusResponse = {
  status: Status
  logs: string[]
  error: string | null
}

export default function App() {
  const [status, setStatus] = useState<Status>('pending')
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [env, setEnv] = useState<EnvInfo | null>(null)
  const [view, setView] = useState<View>('home')
  const [uc, setUc] = useState<UcStatus | null>(null)
  const [ucChecking, setUcChecking] = useState(false)

  const checkUc = useCallback(async () => {
    setUcChecking(true)
    try {
      const resp = await fetch('/api/uc-status')
      if (resp.ok) setUc(await resp.json())
    } catch {
      /* surfaced via the recheck button */
    } finally {
      setUcChecking(false)
    }
  }, [])

  useEffect(() => {
    if (status === 'ready' && uc === null && !ucChecking) checkUc()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    let cancelled = false
    let envFetched = false

    async function pollStatus() {
      try {
        const resp = await fetch('/api/status')
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data: StatusResponse = await resp.json()
        if (cancelled) return
        setStatus(data.status)
        setLogs(data.logs)
        setError(data.error)
        if (data.status === 'ready' && !envFetched) {
          envFetched = true
          fetchEnv()
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }

    async function fetchEnv() {
      try {
        const resp = await fetch('/api/env')
        if (!resp.ok) return
        const data: EnvInfo = await resp.json()
        if (!cancelled) setEnv(data)
      } catch {
        /* ignore */
      }
    }

    pollStatus()
    const id = setInterval(pollStatus, 1500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (status !== 'ready') {
    return (
      <SetupScreen
        status={status}
        logs={logs}
        error={error}
      />
    )
  }

  return (
    <Layout view={view} env={env} onNavigate={setView}>
      {view === 'home' && <HomeView onNavigate={setView} />}
      {view === 'profiler' && <ProfilerView />}
      {view === 'analyzer' && <AnalyzerView />}
      {view === 'converter' && (
        <ConverterView uc={uc} ucChecking={ucChecking} onRecheckUc={checkUc} />
      )}
      {view === 'reconcile' && <ReconcileView />}
    </Layout>
  )
}
