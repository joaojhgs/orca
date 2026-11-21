import type {
  NativeChatMessage,
  NativeChatTurnLifecycle
} from '../../../../../src/shared/native-chat/native-chat-types'
import type { MobileSessionItemPresentation } from '../../mobile-session-item-target'
import type { MobileNativeChatStatus } from '../status/mobile-native-chat-session-status'
import type { OlderPagePhase } from '../transcript/ingestion/use-mobile-older-page-loader'

export type MobileNativeChatSession = MobileSessionItemPresentation & {
  messages: NativeChatMessage[]
  status: MobileNativeChatStatus
  // Unsettled reads or passive resets may still hold another tab’s history; wait before interpreting empty messages as a seed/retirement boundary.
  transcriptLoading: boolean
  error?: string
  /** The read failed for good (damage, or a newer Orca's chat): the error says why, once, and
   *  there is nothing to send into. */
  readFailedFinally?: boolean
  /** This phone's /clear is out and its divider has not landed: the old rows are hidden. */
  clearing?: boolean
  hasMore: boolean
  /** `olderPages === 'loading'`, kept because recorded RPC fixtures read it. */
  loadingEarlier: boolean
  olderPages?: OlderPagePhase
  loadEarlier: () => void
  /** Latest provider turn boundary from the transcript feed; absent from older hosts. */
  transcriptLifecycle?: NativeChatTurnLifecycle
  /** When the rows on screen were saved, while they are an earlier launch's copy no read has confirmed. */
  savedAt?: number | null
}
