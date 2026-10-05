import { getMiniMaxSessionCookieProtection, hasMiniMaxSessionCookie } from './minimax-cookie-store'
import { getMiniMaxApiKeyProtection, hasMiniMaxApiKey } from './minimax-api-key-store'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'

export type MiniMaxCredentialsStatus = {
  configured: boolean
  cookieConfigured: boolean
  apiKeyConfigured: boolean
  cookieProtection: SecretAtRestProtection | null
  apiKeyProtection: SecretAtRestProtection | null
}

export function getMiniMaxCredentialsStatus(): MiniMaxCredentialsStatus {
  const cookieConfigured = hasMiniMaxSessionCookie()
  const apiKeyConfigured = hasMiniMaxApiKey()
  return {
    configured: cookieConfigured || apiKeyConfigured,
    cookieConfigured,
    apiKeyConfigured,
    cookieProtection: cookieConfigured ? getMiniMaxSessionCookieProtection() : null,
    apiKeyProtection: apiKeyConfigured ? getMiniMaxApiKeyProtection() : null
  }
}
