import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { androidRotate, androidTypeText } from './android-input-commands'
import type { AndroidCommandRunner } from './android-command-runner'

describe.runIf(process.platform !== 'win32')('Android text shell boundary', () => {
  it.each([
    'plain',
    'hello world',
    "it's fine",
    'hello&world',
    'say "hello"',
    '$ORCA_ANDROID_TEXT_VALUE',
    '$(printf changed)',
    'semi;printf changed',
    '`printf changed`',
    '*',
    'back\\slash',
    ''
  ])('delivers literal text %j as one input argument', async (text) => {
    let output = ''
    const runner: AndroidCommandRunner = async (_binary, args) => {
      const result = spawnSync(
        '/bin/sh',
        ['-c', `input() { printf '%s\\n' "$#" "$@"; }; ${args.slice(3).join(' ')}`],
        {
          encoding: 'utf8',
          env: { ...process.env, ORCA_ANDROID_TEXT_VALUE: 'expanded' }
        }
      )
      if (result.error) {
        throw result.error
      }
      output = result.stdout
      return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
    }
    await androidTypeText(
      runner,
      { sdkRoot: 'sdk', adb: 'adb', emulator: 'emulator' },
      'emulator-5558',
      text
    )
    expect(output).toBe(`2\ntext\n${text.replace(/ /g, '%s')}\n`)
  })
})

it('maps requested orientation relative to a landscape-native display', async () => {
  const sdk = { sdkRoot: 'sdk', adb: 'adb', emulator: 'emulator' }
  const runner = vi.fn<AndroidCommandRunner>(async () => ({ code: 0, stdout: '', stderr: '' }))

  await androidRotate(runner, sdk, 'waydroid', 'portrait', 'landscape')
  await androidRotate(runner, sdk, 'waydroid', 'landscape_left', 'landscape')

  expect(runner).toHaveBeenCalledWith(sdk.adb, [
    '-s',
    'waydroid',
    'shell',
    'settings',
    'put',
    'system',
    'user_rotation',
    '1'
  ])
  expect(runner).toHaveBeenLastCalledWith(sdk.adb, [
    '-s',
    'waydroid',
    'shell',
    'settings',
    'put',
    'system',
    'user_rotation',
    '0'
  ])
})
