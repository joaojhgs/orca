import type { HermesProfileLink } from '../../../../../shared/bots/hermes-profile'
import { useTranslate } from '@/i18n/use-translate'
import { SettingsInsetGroup } from './BotSettingsRows'

/** Native Hermes settings stay on the remote profile; Orca only owns this conversation. */
export function HermesProfileConnection({ link }: { link: HermesProfileLink }): React.JSX.Element {
  const t = useTranslate()
  return (
    <SettingsInsetGroup title={t('bots.hermes.profile', 'Existing Hermes profile')}>
      <div className="space-y-2 px-3 py-2 text-sm">
        <p className="font-medium">{link.profile}</p>
        <p className="break-all text-xs text-muted-foreground">
          {link.connectionId} · {link.home}
        </p>
        <p className="text-muted-foreground">
          {t(
            'bots.hermes.nativeSettings',
            'Hermes keeps this profile’s instructions, memory, tools, integrations and schedules. Telegram continues independently. This Orca chat has its own conversation history and uses the same profile memory.'
          )}
        </p>
        <p className="break-all text-xs text-muted-foreground">{link.directory}</p>
      </div>
    </SettingsInsetGroup>
  )
}
