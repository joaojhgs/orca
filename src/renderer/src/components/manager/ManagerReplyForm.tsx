import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { useTranslate } from '@/i18n/use-translate'

export function ManagerReplyForm(props: {
  disabled: boolean
  replyTo: string | null
  onCancelAnswer(): void
  onSend(body: string, replyTo?: string): Promise<boolean>
}): React.JSX.Element {
  const t = useTranslate()
  const [body, setBody] = useState('')
  return (
    <form
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (props.disabled || !body.trim()) {
          return
        }
        void props.onSend(body, props.replyTo ?? undefined).then((accepted) => {
          if (accepted) {
            setBody('')
          }
        })
      }}
    >
      <FieldGroup>
        <Field data-disabled={props.disabled}>
          <FieldLabel htmlFor="manager-reply">
            {props.replyTo
              ? t('manager.answerLabel', 'Answer the selected question')
              : t('manager.message', 'Message Hermes')}
          </FieldLabel>
          <Textarea
            id="manager-reply"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={32_000}
            rows={3}
            disabled={props.disabled}
            required
          />
          <FieldDescription>
            {t(
              'manager.replyHelp',
              'Replies provide guidance; they do not grant new permissions or bypass worker approval gates.'
            )}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={props.disabled || !body.trim()}>
          {t('manager.sendReply', 'Send reply')}
        </Button>
        {props.replyTo ? (
          <Button
            type="button"
            variant="ghost"
            onClick={props.onCancelAnswer}
            disabled={props.disabled}
          >
            {t('manager.cancelAnswer', 'Cancel answer')}
          </Button>
        ) : null}
      </div>
    </form>
  )
}
