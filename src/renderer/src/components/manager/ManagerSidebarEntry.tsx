import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

export function ManagerSidebarEntry(): React.JSX.Element {
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
      {translate('manager.navigation', 'Manager')}
    </Button>
  )
}
