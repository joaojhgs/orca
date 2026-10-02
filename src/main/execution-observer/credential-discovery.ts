import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExecutionCredential } from '../../shared/execution-observer'
import { readCursorAuthSession } from '../rate-limits/cursor-auth'
import { getProxyUrlFromEnvironment } from '../../shared/network-proxy'

export function readCredentialRecord(file: string): Record<string, unknown> | null {
  try {
    if (statSync(file).size > 1024 * 1024) {
      return null
    }
    return record(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}
export function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
export function jwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || token.length > 65536) {
    return null
  }
  try {
    return record(JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()))
  } catch {
    return null
  }
}
export function credentialPaths() {
  const home = homedir()
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  return {
    codexHome: process.env.CODEX_HOME || join(home, '.codex'),
    claude: join(claudeDir, '.credentials.json'),
    claudeIdentity: process.env.CLAUDE_CONFIG_DIR
      ? join(claudeDir, '.claude.json')
      : join(home, '.claude.json'),
    antigravity: join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token'),
    opencode: join(
      process.env.XDG_DATA_HOME || join(home, '.local', 'share'),
      'opencode',
      'auth.json'
    )
  }
}
function descriptor(
  provider: ExecutionCredential['provider'],
  sourceRef: string,
  identity: unknown[],
  providerId?: string
): ExecutionCredential {
  const known =
    identity.length > 0 && identity.every((value) => typeof value === 'string' && value.length > 0)
  return {
    provider,
    sourceRef,
    ...(providerId ? { providerId } : {}),
    accountKey: known
      ? createHash('sha256')
          .update(JSON.stringify([provider, providerId, ...identity]))
          .digest('hex')
      : null,
    identityConfidence: known ? 'account' : 'unknown'
  }
}
/** Credential values stay on this execution host; only account fingerprints cross SSH. */
export async function discoverExecutionCredentials(
  options: { resolveProviderIdentity?: boolean } = {}
): Promise<ExecutionCredential[]> {
  const paths = credentialPaths()
  const result: ExecutionCredential[] = []
  const codex = record(readCredentialRecord(join(paths.codexHome, 'auth.json'))?.tokens)
  if (text(codex?.access_token)) {
    const claims = jwtClaims(codex?.access_token)
    const auth = record(claims?.['https://api.openai.com/auth'])
    result.push(
      descriptor('codex', 'codex:default', [
        text(codex?.account_id) || text(auth?.chatgpt_account_id),
        text(auth?.chatgpt_user_id) || text(claims?.sub)
      ])
    )
  }
  const claude = record(readCredentialRecord(paths.claude)?.claudeAiOauth)
  const claudeToken = text(claude?.accessToken)
  if (claudeToken) {
    const identity = record(readCredentialRecord(paths.claudeIdentity)?.oauthAccount)
    result.push({
      ...descriptor('claude', 'claude:default', [
        identity?.accountUuid,
        identity?.organizationUuid
      ]),
      credentialRevision: createHash('sha256').update(claudeToken).digest('hex')
    })
  }
  const cursor = await readCursorAuthSession()
  if (cursor.status === 'ok') {
    result.push(descriptor('cursor', 'cursor:default', [cursor.session.token.subject]))
  }
  const antigravity = readCredentialRecord(paths.antigravity)
  if (text(record(antigravity?.token)?.access_token)) {
    result.push(
      descriptor('antigravity', 'antigravity:default', [jwtClaims(antigravity?.id_token)?.sub])
    )
  }
  const opencode = readCredentialRecord(paths.opencode)
  for (const [providerId, value] of Object.entries(opencode ?? {}).slice(0, 100)) {
    const credential = record(value)
    if (!credential || !/^[\w.-]{1,120}$/.test(providerId)) {
      continue
    }
    if (text(credential.key) || text(credential.access) || text(credential.refresh)) {
      const identity =
        options.resolveProviderIdentity === false
          ? []
          : await resolveOpenCodeIdentity(providerId, credential)
      // Why: different keys are not proof of different accounts; only a provider's stable ID is.
      result.push({
        ...descriptor('opencode', `opencode:${providerId}`, identity, providerId),
        credentialRevision: createHash('sha256')
          .update(
            JSON.stringify([credential.type, credential.key, credential.access, credential.refresh])
          )
          .digest('hex')
      })
    }
  }
  return result.map((credential) => {
    if (credential.identityConfidence === 'account' || credential.credentialRevision) {
      return credential
    }
    const stored =
      credential.provider === 'codex'
        ? codex
        : credential.provider === 'claude'
          ? claude
          : antigravity
    return {
      ...credential,
      credentialRevision: createHash('sha256').update(JSON.stringify(stored)).digest('hex')
    }
  })
}

async function resolveOpenCodeIdentity(
  providerId: string,
  credential: Record<string, unknown>
): Promise<string[]> {
  const token = text(credential.refresh)
  const proxy = getProxyUrlFromEnvironment(process.env)
  if (providerId !== 'github-copilot' || !token || !proxy.ok || proxy.value) {
    return []
  }
  try {
    // Read-only, on the credential owner. Neither the token nor the API response crosses SSH.
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Orca-usage-observer'
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'error'
    })
    if (!response.ok) {
      return []
    }
    const id = record(await response.json())?.id
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? [String(id)] : []
  } catch {
    return []
  }
}
