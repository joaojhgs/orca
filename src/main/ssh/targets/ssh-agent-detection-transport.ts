export type SshAgentDetectionTransport = {
  request(method: string, params: Record<string, unknown>): Promise<unknown>
}

let resolveTransport: ((targetId: string) => SshAgentDetectionTransport | undefined) | null = null

export function setSshAgentDetectionTransportResolver(resolve: typeof resolveTransport): void {
  resolveTransport = resolve
}

export function getSshAgentDetectionTransport(
  targetId: string
): SshAgentDetectionTransport | undefined {
  return resolveTransport?.(targetId)
}
