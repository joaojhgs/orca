import { getSshGitProvider } from '../../../providers/ssh-git-dispatch'
import { SshHostNotServedError } from '../../../providers/ssh-host-not-served-error'

export function requireFilesystemSshGitProvider(connectionId: string) {
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    throw new SshHostNotServedError(connectionId)
  }
  return provider
}
