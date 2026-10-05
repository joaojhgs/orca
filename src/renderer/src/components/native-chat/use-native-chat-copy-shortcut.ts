import { useEffect, type RefObject } from 'react'
import { copyNativeChatText } from './native-chat-clipboard'
import { isMacPlatform } from './native-chat-shortcut'

export function useNativeChatCopyShortcut(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.key.toLowerCase() !== 'c'
      ) {
        return
      }
      const primary = isMacPlatform()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
      if (!primary) {
        return
      }
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')
      ) {
        return
      }
      const selection = window.getSelection()
      const root = rootRef.current
      if (
        !root ||
        !selection ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !selection.focusNode ||
        !root.contains(selection.anchorNode) ||
        !root.contains(selection.focusNode)
      ) {
        return
      }
      const text = selection.toString()
      if (!text) {
        return
      }
      // Retained terminal panes must not consume a chat selection's copy chord.
      event.preventDefault()
      event.stopImmediatePropagation()
      void copyNativeChatText(text)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [rootRef, enabled])
}
