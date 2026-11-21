import type { DirectSshWorktreeAuthority } from '../../../ipc/worktrees/direct-ssh-worktree-authority'
import { pickPreferredGitRemote } from '../../../../shared/git/remotes/preferred-git-remote'
import type { Repo } from '../../../../shared/repository/repo-types'
import { getDefaultRemote } from '../../../git/remotes/repo-remote-queries'
import { getProjectRefForRemote } from '../../../gitlab/projects/gitlab-project-ref-resolution'
import { getGlabKnownHosts } from '../../../gitlab/projects/gitlab-known-host-probe'

export async function resolveRuntimeGitLabIssueSourceRemote(
  repoPath: string,
  preference?: Repo['issueSourcePreference'],
  localGitOptions: { wslDistro?: string } = {},
  ssh?: DirectSshWorktreeAuthority
): Promise<string> {
  const connectionId = ssh?.connectionId ?? null
  const knownHosts = await getGlabKnownHosts(connectionId, localGitOptions)
  const localGitOptionArgs =
    Object.keys(localGitOptions).length > 0 ? ([localGitOptions] as const) : []
  const resolveProject = (remote: string) => {
    ssh?.assertCurrent()
    return getProjectRefForRemote(repoPath, remote, knownHosts, connectionId, ...localGitOptionArgs)
  }
  if (preference === 'origin') {
    if (await resolveProject('origin')) {
      return 'origin'
    }
    throw new Error('No GitLab project found for origin.')
  }
  if (preference === 'upstream') {
    if (await resolveProject('upstream')) {
      return 'upstream'
    }
    if (await resolveProject('origin')) {
      return 'origin'
    }
    throw new Error('No GitLab project found for upstream or origin.')
  }
  if (await resolveProject('upstream')) {
    return 'upstream'
  }
  if (await resolveProject('origin')) {
    return 'origin'
  }
  if (ssh) {
    ssh.assertCurrent()
    const { stdout } = await ssh.provider.exec(['remote'], repoPath)
    return pickPreferredGitRemote(stdout.split('\n'))
  }
  return getDefaultRemote(repoPath, localGitOptions)
}
