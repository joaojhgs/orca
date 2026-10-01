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

const approvalSchema = z.object({
  requestId: z.string().uuid(),
  command: z.string(),
  expiresAt: z.number(),
  enabled: z.boolean()
})
const checkSchema = z.object({ status: z.enum(['pending', 'expired', 'approved']) })

export function ArtifactPublishingApprovalDialog({
  enabled
}: {
  enabled: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState<z.infer<typeof approvalSchema> | null>(null)

  const start = async (): Promise<void> => {
    setOpen(true)
    setBusy(true)
    setError('')
    setRequest(null)
    try {
      const reply = await window.api.runtime.call({
        method: 'settings.requestArtifactPublishingApproval',
        params: { enabled: !enabled }
      })
      if (!reply.ok) {
        throw new Error(
          reply.error.code === 'method_not_found'
            ? 'This host needs a newer Orca build. Use its desktop Artifacts settings.'
            : reply.error.message
        )
      }
      setRequest(approvalSchema.parse(reply.result))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request approval.')
    } finally {
      setBusy(false)
    }
  }

  const check = async (): Promise<void> => {
    if (!request) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const reply = await window.api.runtime.call({
        method: 'settings.checkArtifactPublishingApproval',
        params: { requestId: request.requestId }
      })
      if (!reply.ok) {
        throw new Error(reply.error.message)
      }
      const { status } = checkSchema.parse(reply.result)
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not check approval.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void start()}>
        {enabled ? 'Request disabling publishing' : 'Request publishing approval'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {enabled ? 'Disable artifact publishing' : 'Approve public artifact publishing'}
            </DialogTitle>
            <DialogDescription>
              {enabled
                ? 'New uploads will be blocked. Existing public links remain until deleted.'
                : 'This lets every caller on this host publish HTML and Markdown as public links. Anyone with a link can read the content. Do not publish secrets.'}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Run this one-time command yourself over SSH on the connected Orca host, as the user
            running Orca. Do not ask an agent to run it. It expires after five minutes.
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
              Close
            </Button>
            <Button disabled={busy || !request} onClick={() => void check()}>
              Check my approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
