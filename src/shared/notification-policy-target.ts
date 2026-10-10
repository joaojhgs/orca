import type { NotificationScopePolicy, NotificationPolicyScope } from './notification-scope-policy'

export type NotificationPolicyTarget = {
  label: string
  selector: NotificationScopePolicy['rules'][number]['selector']
  scope: NotificationPolicyScope
}

export function notificationSelectorKey(selector: NotificationPolicyTarget['selector']): string {
  return JSON.stringify(selector)
}

export function notificationSelectorScope(
  selector: NotificationPolicyTarget['selector']
): NotificationPolicyScope {
  switch (selector.level) {
    case 'server':
      return {}
    case 'project-group':
      return { projectGroupId: selector.id }
    case 'project':
      return { projectId: selector.id }
    case 'workspace':
      return { workspaceId: selector.id, executionHostId: selector.executionHostId }
    case 'session':
      return { sessionId: selector.id, sessionGeneration: selector.generation }
  }
}
