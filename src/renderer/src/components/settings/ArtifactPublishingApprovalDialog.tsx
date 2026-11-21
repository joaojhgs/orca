import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'

const approvalSchema = z.object({
  requestId: z.string().uuid(),
  command: z.string(),
  expiresAt: z.number(),
  enabled: z.boolean()
})
const checkSchema = z.object({ status: z.enum(['pending', 'expired', 'approved']) })

async function requestPublishingApproval(enabled: boolean) {
  const reply = await window.api.runtime.call({
    method: 'settings.requestArtifactPublishingApproval',
    params: { enabled }
  })
  if (!reply.ok) {
    throw new Error(
      reply.error.code === 'method_not_found'
        ? 'This host needs a newer Orca build. Use its desktop Artifacts settings.'
        : reply.error.message
    )
  }
  return approvalSchema.parse(reply.result)
}

async function checkPublishingApproval(requestId: string) {
  const reply = await window.api.runtime.call({
    method: 'settings.checkArtifactPublishingApproval',
    params: { requestId }
  })
  if (!reply.ok) {
    throw new Error(reply.error.message)
  }
  return checkSchema.parse(reply.result).status
}

export function ArtifactPublishingApprovalDialog({
  enabled
}: {
  enabled: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState<z.infer<typeof approvalSchema> | null>(null)

  const start = (): void => {
    setOpen(true)
    setBusy(true)
    setError('')
    setRequest(null)
    void requestPublishingApproval(!enabled)
      .then(setRequest)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not request approval.')
      })
      .finally(() => setBusy(false))
  }

  const check = (): void => {
    if (!request) {
      return
    }
    setBusy(true)
    setError('')
    void checkPublishingApproval(request.requestId)
      .then(async (status) => {
        if (status === 'approved') {
          const settings = await window.api.settings.get()
          useAppStore.setState({ settings })
          setOpen(false)
        } else {
          setError(
            status === 'expired'
              ? 'Approval expired. Close and request a new one.'
              : 'Not approved yet. Run the command yourself on the connected host first.'
          )
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not check approval.')
      })
      .finally(() => setBusy(false))
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void start()}>
        {enabled
          ? t(
              'auto.components.settings.ArtifactPublishingApprovalDialog.7bbab43793',
              'Request disabling publishing'
            )
          : t(
              'auto.components.settings.ArtifactPublishingApprovalDialog.d4ecf82a7e',
              'Request publishing approval'
            )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent surface="security">
          <DialogHeader>
            <DialogTitle>
              {enabled
                ? t(
                    'auto.components.settings.ArtifactPublishingApprovalDialog.ae77d3ab38',
                    'Disable artifact publishing'
                  )
                : t(
                    'auto.components.settings.ArtifactPublishingApprovalDialog.d050e1f668',
                    'Approve public artifact publishing'
                  )}
            </DialogTitle>
            <DialogDescription>
              {enabled
                ? t(
                    'auto.components.settings.ArtifactPublishingApprovalDialog.d12ee4d9fb',
                    'New uploads will be blocked. Existing public links remain until deleted.'
                  )
                : t(
                    'auto.components.settings.ArtifactPublishingApprovalDialog.9ca5e27d96',
                    'This lets every caller on this host publish HTML and Markdown as public links. Anyone with a link can read the content. Do not publish secrets.'
                  )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {t(
              'auto.components.settings.ArtifactPublishingApprovalDialog.9ffb1f3764',
              'Run this one-time command yourself over SSH on the connected Orca host, as the user running Orca. Do not ask an agent to run it. It expires after five minutes.'
            )}
          </p>
          {request ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">
              <code>{request.command}</code>
            </pre>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('auto.components.settings.ArtifactPublishingApprovalDialog.f297f670b6', 'Close')}
            </Button>
            <Button disabled={busy || !request} onClick={() => void check()}>
              {t(
                'auto.components.settings.ArtifactPublishingApprovalDialog.078d9b75be',
                'Check my approval'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
