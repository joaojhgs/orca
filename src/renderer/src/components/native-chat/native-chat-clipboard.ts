import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { describeClipboardWriteFailure } from '@/lib/clipboard-write-failure'

export async function copyNativeChatText(text: string): Promise<boolean> {
  try {
    // Use the verified native writer; older clients retain the normal writer.
    const write = window.api.ui.writeTerminalClipboardText ?? window.api.ui.writeClipboardText
    await write(text)
    return true
  } catch (error) {
    toast.error(translate('components.native-chat.copyMessage.failed', 'Unable to copy text'), {
      description: describeClipboardWriteFailure(error)
    })
    return false
  }
}
