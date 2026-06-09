import { type ReactNode } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { EnvFooter } from './EnvFooter'
import type { EnvInfo, View } from '../types'

type Props = {
  view: View
  env: EnvInfo | null
  onNavigate: (view: View) => void
  children: ReactNode
}

export function Layout({ view, env, onNavigate, children }: Props) {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      <Header env={env} />
      <div className="flex flex-1 min-h-0">
        {view !== 'home' && <Sidebar active={view} onSelect={onNavigate} />}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 bg-white">
          <div className={'flex-1 overflow-y-auto' + (view === 'home' ? '' : ' p-6')}>
            {children}
          </div>
          <EnvFooter env={env} />
        </main>
      </div>
    </div>
  )
}
