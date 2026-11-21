import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'

export function ManagerSidebarEntry(): React.JSX.Element {
  const t = useTranslate()
  const open = useAppStore((state) => state.openManagerPage)
  const active = useAppStore((state) => state.activeView === 'manager')
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={open}
      aria-current={active ? 'page' : undefined}
      data-current={active}
    >
      <Bot data-icon="inline-start" />
      {t('manager.navigation', 'Manager')}
    </Button>
  )
}
