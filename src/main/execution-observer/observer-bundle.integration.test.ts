import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { runProcess } from '@orca/process-host'
import { expect, it } from 'vitest'

it('discovers credentials through the standalone SSH payload without desktop worker files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-observer-bundle-'))
  try {
    const home = join(root, 'home')
    const config = join(home, '.config')
    const codex = join(home, '.codex')
    const cursor = join(config, 'Cursor', 'User', 'globalStorage')
    await Promise.all([mkdir(codex, { recursive: true }), mkdir(cursor, { recursive: true })])
    const claims = Buffer.from(
      JSON.stringify({
        sub: 'observer-fixture-user',
        'https://api.openai.com/auth': { chatgpt_account_id: 'observer-fixture-account' }
      })
    ).toString('base64url')
    const token = `e30.${claims}.observer-fixture-signature`
    await writeFile(join(codex, 'auth.json'), JSON.stringify({ tokens: { access_token: token } }))
    const db = new DatabaseSync(join(cursor, 'state.vscdb'))
    db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)')
    db.close()
    const build = await runProcess({
      program: process.execPath,
      args: [resolve('config/scripts/build-execution-observer.mjs')],
      env: { ...process.env, ORCA_BUILD_OUTPUT_DIR: join(root, 'out') },
      timeoutMs: 20_000
    })
    expect(build.code, build.stderr).toBe(0)
    const bundle = await readFile(join(root, 'out', 'main', 'execution-observer.cjs'), 'utf8')
    const input = `process.env.ORCA_OBSERVER_REQUEST = '${Buffer.from('{"operation":"discover"}').toString('base64')}';\n${bundle}`
    const reply = await runProcess({
      program: process.execPath,
      args: ['-'],
      input,
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: codex,
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        XDG_CONFIG_HOME: config,
        XDG_DATA_HOME: join(home, '.local', 'share')
      },
      timeoutMs: 20_000
    })
    expect(reply.code, reply.stderr).toBe(0)
    const result = reply.stdout.split('\n').find((line) => line.startsWith('ORCA_OBSERVER_RESULT:'))
    expect(result).toBeDefined()
    expect(JSON.parse(result?.slice('ORCA_OBSERVER_RESULT:'.length) ?? 'null')).toEqual([
      expect.objectContaining({
        provider: 'codex',
        sourceRef: 'codex:default',
        identityConfidence: 'account'
      })
    ])
    expect(reply.stdout).not.toContain(token)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
