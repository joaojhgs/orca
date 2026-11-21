import type { SshPtyConsumerSessionAdapter } from './ssh-pty-consumer-session-adapter'
import type {
  RelayPtySourceDeliveryRecord,
  RelayPtySourcePublicationCounters
} from './relay-pty-source-send-scheduler'

export function getPtySourceSendSnapshot(
  deliveries: Iterable<RelayPtySourceDeliveryRecord>,
  session: Pick<SshPtyConsumerSessionAdapter, 'sourceDeliverySnapshotIfKnown'>,
  counters: RelayPtySourcePublicationCounters
) {
  let active = 0
  let activating = 0
  let sealedUnsettled = 0
  let outstandingSourceUnits = 0
  for (const record of deliveries) {
    const snapshot = session.sourceDeliverySnapshotIfKnown(record.identity)
    if (!snapshot) {
      continue
    }
    outstandingSourceUnits += snapshot.sentEndSu - snapshot.creditedEndSu
    if (record.activating) {
      activating++
    } else if (record.sealed && snapshot.state !== 'closed') {
      sealedUnsettled++
    } else if (snapshot.state === 'active') {
      active++
    }
  }
  return Object.freeze({
    active,
    activating,
    sealedUnsettled,
    outstandingSourceUnits,
    ...counters
  })
}
