import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Updater } from '@aphrody/koharu-ui/components/app/Updater'

describe('updater', () => {
  it('renders Markdown release notes inside a viewport-bounded scroll area', async () => {
    const update = {
      version: '0.63.0',
      body: '# Highlights\n\n- Fixed the canvas\n\n[Full changelog](https://example.com/changelog)',
    }

    render(<Updater state={{ kind: 'available', update }} onDismiss={vi.fn()} onInstall={vi.fn()} />)

    const heading = await screen.findByRole('heading', { level: 1, name: 'Highlights' })
    const title = screen.getByRole('heading', {
      level: 2,
      name: 'Update available',
    })
    const copy = title.parentElement
    const header = copy?.parentElement
    expect(copy).toContainElement(
      header?.querySelector('[data-slot="alert-dialog-description"]') ?? null,
    )
    expect(header).toHaveClass('flex', 'flex-row', 'items-start', 'gap-4', 'text-left')
    expect(header).not.toHaveClass('grid', 'text-center')
    expect(screen.getByRole('listitem')).toHaveTextContent('Fixed the canvas')
    expect(heading.closest('[data-slot="scroll-area"]')).toHaveClass(
      'h-64',
      'max-h-[40dvh]',
      'min-h-0',
    )
    expect(screen.getByRole('alertdialog')).toHaveClass(
      'flex',
      'max-h-[calc(100dvh-2rem)]',
      'flex-col',
      'overflow-hidden',
    )

    expect(screen.getByRole('link', { name: 'Full changelog' })).toHaveAttribute(
      'href',
      'https://example.com/changelog',
    )
  })
})
