import type { TerminalOutputSourceRange } from '../../../../shared/terminal-output-source-range'
import { OrcaRuntimeWithPreparePtyExecutionContext } from '../launch/terminal-execution-context'

export abstract class OrcaRuntimeWithPtyIngestionAdmission extends OrcaRuntimeWithPreparePtyExecutionContext {
  abstract onPtyData(
    ptyId: string,
    data: string,
    at: number,
    sequenceChars?: number,
    transformed?: boolean,
    acceptCompletion?: (completion: Promise<void>) => void,
    sourceRanges?: readonly TerminalOutputSourceRange[]
  ): number

  resetPtyModelAfterMigrationFailure(ptyId: string): void {
    this.providerSnapshotPreferredPtys.add(ptyId)
    this.disposeHeadlessTerminal(ptyId)
  }

  /**
   * Handles incoming data from a PTY process, running agent detection,
   * updating terminal tail buffers, and triggering foreground agent refreshes.
   */
  acceptPtyDataBounded(
    ptyId: string,
    data: string,
    at: number,
    sequenceChars = data.length,
    transformed = false,
    sourceRanges?: readonly TerminalOutputSourceRange[]
  ): { sequence: number; completion: Promise<void> } {
    let completion: Promise<void> | null = null
    const sequence = this.onPtyData(
      ptyId,
      data,
      at,
      sequenceChars,
      transformed,
      (receipt) => {
        completion = receipt
      },
      sourceRanges
    )
    if (!completion) {
      throw new Error('PTY model admission receipt was not captured')
    }
    return Object.freeze({ sequence, completion })
  }
}
