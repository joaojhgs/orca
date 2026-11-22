import { botOnSetup } from '../../shared/bots/bot-agent-setup'
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { HermesProfileLinkSchema } from '../../shared/bots/hermes-profile'
import { BotSchema } from '../../shared/bot-types'
import { BotCreate } from '../../shared/rpc-contract/bots-params'
import { newBotRecord } from '../bots/bot-new-record'
import { hermesProfileCommand } from './hermes-profile-launch'

const link = {
  connectionId: 'worker',
  profile: 'personal',
  home: '/home/developer/.hermes/profiles/personal',
  directory: "/home/developer/Documents/My vault's notes; echo INJECTED"
}
const target = {
  id: 'worker',
  label: 'Worker',
  host: 'worker.example',
  port: 22,
  username: 'developer'
}

describe('existing Hermes profiles', () => {
  it('keeps a durable link without starting Orca persona import or first-run onboarding', () => {
    const input = BotCreate.parse({ name: 'Personal', hermesProfile: link })
    const record = newBotRecord(input, 1)
    expect(record.agent).toBe('hermes')
    expect(record.firstRun).toBeUndefined()
    expect(record.hermesProfile).toEqual(link)
    expect(() => botOnSetup(record, { agent: 'codex' })).toThrow('existing Hermes profile')
    expect(
      BotSchema.parse({ ...record, folder: 'personal', folderWorkspaceId: 'folder-1' })
        .hermesProfile
    ).toEqual(link)
    expect(newBotRecord({ name: 'Ordinary' }, 1).firstRun).toBe(true)
  })

  it('rejects cross-target links and malformed profile/home selections', () => {
    expect(() => hermesProfileCommand(link, { ...target, id: 'other' })).toThrow('mismatch')
    expect(() =>
      hermesProfileCommand({ ...link, home: '/home/developer/.hermes/profiles/work' }, target)
    ).toThrow('mismatch')
    expect(HermesProfileLinkSchema.safeParse({ ...link, profile: '../work' }).success).toBe(false)
    expect(HermesProfileLinkSchema.safeParse({ ...link, directory: '/vault\ncmd' }).success).toBe(
      false
    )
  })

  it('uses the saved SSH identity without forwarding and shell-quotes remote profile paths', () => {
    const args = hermesProfileCommand(link, target)
    expect(args).toContain('ForwardAgent=no')
    expect(args).toContain('ClearAllForwardings=yes')
    expect(args).toContain('StrictHostKeyChecking=yes')
    expect(args).toContain('BatchMode=yes')
    expect(args).toContain('developer@worker.example')
    const remote = args.at(-1)!
    expect(remote).toContain('HERMES_HOME=')
    expect(remote).not.toContain('auth.json')
    // A directory containing a quote and shell metacharacters remains one cd argument.
    if (process.platform !== 'win32') {
      const command = remote.split(' && ')[1]!.replace(/^cd /, 'printf "%s" ')
      const result = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe(link.directory)
    }
  })
})
