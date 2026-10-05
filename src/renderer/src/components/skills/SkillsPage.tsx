import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { useActiveSkillDiscoveryRuntimeTarget } from '@/hooks/use-active-skill-discovery-runtime-target'
import { SkillLibraryView } from './SkillLibraryView'
import { SkillInstallDialog } from './SkillInstallDialog'

export default function SkillsPage(): React.JSX.Element {
  const target = useActiveSkillDiscoveryRuntimeTarget()
  const close = useAppStore((state) => state.closeSkillsPage)
  const pendingShare = useAppStore((state) => state.pendingSkillShareId)
  const clearShare = useAppStore((state) => state.clearPendingSkillShare)
  const pendingLinks = useAppStore((state) => state.pendingSkillsSharedView)
  const clearLinks = useAppStore((state) => state.clearPendingSkillsSharedView)
  const [sharedView, setSharedView] = useState(false)
  const [installLink, setInstallLink] = useState('')
  useEffect(() => {
    if (pendingLinks) {
      setSharedView(true)
      clearLinks()
    }
  }, [pendingLinks, clearLinks])
  useEffect(() => {
    if (pendingShare) {
      setInstallLink(`https://app.orca.dev/skills/share/${pendingShare}`)
      clearShare()
    }
  }, [pendingShare, clearShare])
  return (
    <>
      <SkillLibraryView
        target={target}
        onClose={close}
        requestedSharedView={sharedView}
        onSharedViewHandled={() => setSharedView(false)}
      />
      <SkillInstallDialog
        key={installLink || 'closed'}
        open={Boolean(installLink)}
        initialLink={installLink}
        onOpenChange={(open) => !open && setInstallLink('')}
      />
    </>
  )
}
