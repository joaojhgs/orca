import { createRoot } from 'react-dom/client'
import { SkillLibraryView } from '../../src/renderer/src/components/skills/SkillLibraryView'
import { TooltipProvider } from '../../src/renderer/src/components/ui/tooltip'
import { ConfirmationDialogContext } from '../../src/renderer/src/components/confirmation-dialog-context'
import '../../src/renderer/src/assets/main.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing fixture root')
}
createRoot(root).render(
  <TooltipProvider>
    <ConfirmationDialogContext.Provider value={async () => false}>
      <SkillLibraryView target={{ kind: 'local' }} onBack={() => {}} onClose={() => {}} />
    </ConfirmationDialogContext.Provider>
  </TooltipProvider>
)
