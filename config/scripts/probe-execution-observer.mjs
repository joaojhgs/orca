import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const valueAfter = (flag) => process.argv[process.argv.indexOf(flag) + 1]
const bundle = await readFile(
  process.argv.includes('--bundle') ? valueAfter('--bundle') : 'out/main/execution-observer.cjs',
  'utf8'
)
const sshHost = process.argv.includes('--ssh-host') ? valueAfter('--ssh-host') : null
async function observe(request) {
  const encoded = Buffer.from(JSON.stringify(request)).toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(
      sshHost ? 'ssh' : 'podman',
      sshHost
        ? ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', sshHost, 'node -']
        : [
            'exec',
            '-i',
            '--user',
            'developer',
            '--env',
            'HOME=/home/developer',
            '--env',
            `ORCA_OBSERVER_REQUEST=${encoded}`,
            'personal',
            '/usr/bin/node',
            '-'
          ],
      { stdio: 'pipe' }
    )
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => {
      output = (output + chunk).slice(-1048576)
    })
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-2048)
    })
    child.stdin.on('error', () => {})
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      const line = output.split('\n').find((line) => line.startsWith('ORCA_OBSERVER_RESULT:'))
      if (!line || code !== 0) {
        return reject(
          new Error(
            `Observer failed (${code}); ${errors.match(/(?:TypeError|ReferenceError|Error)(?: \[[\w_]+\])?:[^\n]{1,400}/)?.[0] || 'transport-error'}`
          )
        )
      }
      try {
        resolve(JSON.parse(line.slice('ORCA_OBSERVER_RESULT:'.length)))
      } catch {
        reject(new Error('Invalid observer response'))
      }
    })
    const timer = setTimeout(() => child.kill('SIGTERM'), 120000)
    child.stdin.end(`process.env.ORCA_OBSERVER_REQUEST=${JSON.stringify(encoded)};\n${bundle}`)
  })
}
const credentials = await observe({ operation: 'discover' })
console.log(JSON.stringify({ operation: 'discover', credentials }))
if (process.argv.includes('--usage')) {
  for (const credential of credentials) {
    const limits = await observe({ operation: 'usage', credential })
    console.log(JSON.stringify({ sourceRef: credential.sourceRef, limits }))
  }
}
if (process.argv.includes('--ports')) {
  const path = process.argv.includes('--workspace') ? valueAfter('--workspace') : null
  const workspaces = path
    ? [
        {
          id: 'validation-workspace',
          repoId: 'validation',
          displayName: 'Validation workspace',
          path
        }
      ]
    : []
  console.log(JSON.stringify(await observe({ operation: 'ports', workspaces })))
}
