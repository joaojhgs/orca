import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  executionCredentialSchema,
  type ExecutionObserverRequest,
  type ExecutionCredential
} from '../../shared/execution-observer'
import {
  executionPortsSchema,
  executionUsageSchema
} from '../../shared/execution-observer-response'
import { runProcess } from '../../shared/child-process/run-process'
import type { SshConnection } from '../ssh/ssh-connection'
import { execCommand } from '../ssh/ssh-relay-exec-command'

export class ExecutionObserverClient {
  private bundle: Promise<string> | null = null
  constructor(private readonly bundlePath = join(__dirname, 'execution-observer.cjs')) {}

  async observe(request: ExecutionObserverRequest, connection?: SshConnection): Promise<unknown> {
    this.bundle ??= readFile(this.bundlePath, 'utf8').catch((error) => {
      this.bundle = null
      throw error
    })
    const encoded = Buffer.from(JSON.stringify(request)).toString('base64')
    const input = `process.env.ORCA_OBSERVER_REQUEST = ${JSON.stringify(encoded)};\n${await this.bundle}`
    let output: string
    if (connection) {
      if (connection.getState().status !== 'connected') {
        throw new Error('SSH observation is unverifiable while disconnected')
      }
      output = await execCommand(connection, 'node -', { input, timeoutMs: 70000 })
      if (connection.getState().status !== 'connected') {
        throw new Error('SSH observation became unverifiable')
      }
    } else {
      const result = await runProcess({
        program: process.execPath,
        args: ['-'],
        input,
        maxOutputBytes: 1024 * 1024,
        timeoutMs: 70000,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          ORCA_BACKGROUND_LAUNCH: '1',
          NODE_OPTIONS: '--max-old-space-size=384'
        }
      })
      if (result.code !== 0 || result.outputTruncated || result.timedOut) {
        throw new Error('Local observation failed')
      }
      output = result.stdout
    }
    const line = output.split('\n').findLast((line) => line.startsWith('ORCA_OBSERVER_RESULT:'))
    if (!line || line.length > 1024 * 1024) {
      throw new Error('Invalid execution-host observation')
    }
    return JSON.parse(line.slice('ORCA_OBSERVER_RESULT:'.length))
  }

  async discover(connection?: SshConnection): Promise<ExecutionCredential[]> {
    return z
      .array(executionCredentialSchema)
      .max(104)
      .parse(await this.observe({ operation: 'discover' }, connection))
  }
  async usage(credential: ExecutionCredential, connection?: SshConnection) {
    return executionUsageSchema.parse(
      await this.observe({ operation: 'usage', credential }, connection)
    )
  }
  async ports(
    workspaces: Extract<ExecutionObserverRequest, { operation: 'ports' }>['workspaces'],
    connection: SshConnection
  ) {
    return executionPortsSchema.parse(
      await this.observe({ operation: 'ports', workspaces }, connection)
    )
  }
}

export const executionObserverClient = new ExecutionObserverClient()
