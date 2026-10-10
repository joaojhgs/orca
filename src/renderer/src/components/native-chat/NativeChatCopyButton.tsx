import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { copyNativeChatText } from './native-chat-clipboard'

/**
 * Per-message copy affordance for the native chat. Copies the message's text to
 * the clipboard and briefly swaps the icon to a check tint as success feedback —
 * matching the app's other inline copy buttons. Failed writes show an error.
 */
export function NativeChatCopyButton({
  text,
  label: copyLabel,
  className
}: {
  text: string
  /** What this button copies, when it is not the whole message. */
  label?: string
  className?: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    if (await copyNativeChatText(text)) {
      setCopied(true)
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null
        setCopied(false)
      }, 1500)
    } else {
      setCopied(false)
    }
  }, [text])

  const label = copied
    ? translate('components.native-chat.copyMessage.copied', 'Copied')
    : (copyLabel ?? translate('components.native-chat.copyMessage.copy', 'Copy message'))

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        copied && 'text-status-success',
        className
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}
