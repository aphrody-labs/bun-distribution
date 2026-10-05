'use client'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke, isTauri } from '@aphrody/api/core'

import { AgentPanel } from '@aphrody/koharu-ui/components/editor/AgentPanel'
import { ShenronExportPanel } from '@aphrody/koharu-ui/components/ShenronExportPanel'
import { Inspector } from '@aphrody/koharu-ui/components/editor/Inspector'
import { rightSidebarPanels, type RightSidebarPanel } from '@aphrody/koharu-ui/navigation'
import { Button } from '../../internal/components/button'

const shenronHost = {
  isTauri,
  invoke: <T,>(command: string, args: Record<string, unknown>) => invoke<T>(command, args),
}

export function RightSidebar() {
  const { t } = useTranslation()
  const [panel, setPanel] = useState<RightSidebarPanel>('properties')

  return (
    <aside className='flex h-full min-h-0 flex-col bg-[var(--surface-panel)]'>
      <div className='flex h-10 shrink-0 items-center gap-1 border-b border-border/80 px-2.5'>
        {rightSidebarPanels.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant={panel === id ? 'secondary' : 'ghost'}
            size='sm'
            className='h-7 flex-1 text-[10px]'
            onClick={() => setPanel(id)}
          >
            <Icon className='size-3' /> {t(label)}
          </Button>
        ))}
      </div>
      <div className={panel === 'agent' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
        <AgentPanel />
      </div>
      <div className={panel === 'properties' ? 'min-h-0 flex-1' : 'hidden'}>
        <Inspector />
      </div>
      {panel === 'shenron' && (
        <div className='flex min-h-0 flex-1 flex-col'>
          <ShenronExportPanel host={shenronHost} />
        </div>
      )}
    </aside>
  )
}
