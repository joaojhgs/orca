import { useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'
import {
  SKILL_LIBRARY_LINK_CAPABILITY,
  SkillLibraryLinkResultSchema
} from '../../../../shared/skill-library-link-contract'
import type { useSkillLibrary } from './use-skill-library'
import type { HostedSkillCandidate } from './skill-library-host-discovery'

export function SkillLibraryLinkImport(props: {
  library: ReturnType<typeof useSkillLibrary>
  onCandidates(candidates: HostedSkillCandidate[]): void
}) {
  const [url, setUrl] = useState('')
  const scan = async () => {
    const result = await props.library.run(async (target) => {
      const status = z
        .object({ capabilities: z.array(z.string()).optional() })
        .parse(await callRuntimeRpc(target, 'status.get'))
      if (!status.capabilities?.includes(SKILL_LIBRARY_LINK_CAPABILITY)) {
        throw new Error('Update this Orca server to enable link imports.')
      }
      return SkillLibraryLinkResultSchema.parse(
        await callRuntimeRpc(target, 'skills.library.discoverUrl', { url }, { timeoutMs: 120000 })
      )
    })
    if (result) {
      props.onCandidates(
        result.candidates.map((candidate) => ({
          ...candidate,
          hostId: result.hostId,
          hostLabel: result.label
        }))
      )
    }
  }
  return (
    <section
      className="flex flex-col gap-2"
      aria-label={translate('skills.library.linkImport', 'Import from a link')}
    >
      <Label htmlFor="skill-library-import-url">
        {translate('skills.library.sourceLink', 'Plugin, marketplace, or skill link')}
      </Label>
      <Input
        id="skill-library-import-url"
        type="url"
        value={url}
        disabled={props.library.busy}
        placeholder="https://github.com/owner/skills"
        onChange={(event) => setUrl(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {translate(
          'skills.library.linkHelp',
          'Public GitHub repositories, plugin/marketplace repositories, skill folder links, and skills.sh links. Imports skills only—not plugins, hooks, or installation scripts. Review before importing.'
        )}
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={props.library.busy || !url.trim()}
        onClick={() => void scan()}
      >
        {props.library.busy
          ? translate('skills.library.loadingLink', 'Reading source…')
          : translate('skills.library.scanLink', 'Scan link')}
      </Button>
    </section>
  )
}
