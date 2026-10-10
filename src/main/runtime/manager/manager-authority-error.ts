export class ManagerAuthorityError extends Error {
  constructor(
    readonly code:
      | 'manager_unauthorized'
      | 'manager_forbidden'
      | 'manager_consumer_fenced'
      | 'manager_consumer_busy',
    message: string
  ) {
    super(message)
    this.name = 'ManagerAuthorityError'
  }
}
