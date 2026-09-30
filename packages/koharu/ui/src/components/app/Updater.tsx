'use client'

import { Download, RefreshCw } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '../../internal/components/alert-dialog'
import { Progress } from '../../internal/components/progress'
import { ScrollArea } from '../../internal/components/scroll-area'

export interface UpdateInfo {
  version: string
  body?: string | null
}

export type UpdateState =
  | { kind: 'available'; update: UpdateInfo }
  | { kind: 'downloading'; update: UpdateInfo; downloaded: number; total: number | null }
  | { kind: 'error'; update: UpdateInfo; message: string }

export function Updater({
  state,
  onDismiss,
  onInstall,
}: {
  state: UpdateState | null
  onDismiss(): void
  onInstall(update: UpdateInfo): void
}) {
  const { t } = useTranslation()

  if (!state) return null

  const downloading = state.kind === 'downloading'
  const percent =
    downloading && state.total ? Math.min(100, (state.downloaded / state.total) * 100) : null

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !downloading) {
          onDismiss()
        }
      }}
    >
      <AlertDialogContent className='flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden'>
        <AlertDialogHeader className='flex shrink-0 flex-row items-start gap-4 text-left'>
          <AlertDialogMedia className='mb-0 shrink-0'>
            {state.kind === 'error' ? (
              <RefreshCw className='size-5' />
            ) : (
              <Download className='size-5' />
            )}
          </AlertDialogMedia>
          <div className='min-w-0 space-y-1.5'>
            <AlertDialogTitle>
              {state.kind === 'available'
                ? t('updater.available.title')
                : state.kind === 'downloading'
                  ? t('updater.downloading.title')
                  : t('updater.error.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {state.kind === 'available' ? (
                <Trans
                  i18nKey='updater.available.description'
                  values={{ version: state.update.version }}
                  components={{ strong: <strong className='font-medium text-foreground' /> }}
                />
              ) : state.kind === 'downloading' ? (
                t('updater.downloading.subtitle', { version: state.update.version })
              ) : (
                t('updater.error.description')
              )}
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        {state.kind === 'available' && (
          <ScrollArea
            className='h-64 max-h-[40dvh] min-h-0 rounded-lg bg-muted/45'
            viewportClassName='p-3'
          >
            {state.update.body ? (
              <div className='min-w-0 text-xs leading-5 break-words text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:break-all [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_h3]:text-foreground [&_hr]:my-3 [&_hr]:border-border [&_img]:h-auto [&_img]:max-w-full [&_li]:my-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:break-normal [&_table]:my-2 [&_table]:w-full [&_table]:table-fixed [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_th]:border [&_th]:border-border [&_th]:p-1.5 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0'>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a({ href, children }) {
                      return <a href={href} target='_blank' rel='noopener noreferrer'>{children}</a>
                    },
                  }}
                >
                  {state.update.body}
                </ReactMarkdown>
              </div>
            ) : (
              <p className='text-xs leading-5 text-muted-foreground'>{t('updater.noNotes')}</p>
            )}
          </ScrollArea>
        )}
        {state.kind === 'downloading' && (
          <Progress value={percent} aria-label={t('updater.downloading.title')}>
            <span className='ml-auto text-xs text-muted-foreground tabular-nums'>
              {percent === null ? '…' : `${Math.round(percent)}%`}
            </span>
          </Progress>
        )}
        {state.kind === 'error' && (
          <ScrollArea
            className='max-h-28'
            viewportClassName='text-xs leading-5 text-muted-foreground'
          >
            <p>{state.message}</p>
          </ScrollArea>
        )}

        {!downloading && (
          <AlertDialogFooter className='shrink-0'>
            <AlertDialogCancel>
              {state.kind === 'available' ? t('updater.later') : t('updater.close')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => onInstall(state.update)}>
              {state.kind === 'available' ? t('updater.update') : t('updater.retry')}
            </AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
