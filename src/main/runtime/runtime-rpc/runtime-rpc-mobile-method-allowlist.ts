import { SKILL_LIBRARY_RPC_METHODS } from '../../../shared/skill-library-contract'
import { MOBILE_CORE_RPC_METHOD_ALLOWLIST } from './runtime-rpc-mobile-core-method-allowlist'

export const MOBILE_RPC_METHOD_ALLOWLIST = new Set([
  ...MOBILE_CORE_RPC_METHOD_ALLOWLIST,
  ...SKILL_LIBRARY_RPC_METHODS
])
