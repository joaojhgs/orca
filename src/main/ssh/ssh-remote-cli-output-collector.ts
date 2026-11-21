export class CappedOutputCollector {
  private readonly chunks: Buffer[] = []
  private bytes = 0
  private truncated = false

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    if (this.truncated) {
      return
    }
    const remaining = this.maxBytes - this.bytes
    if (chunk.length >= remaining) {
      this.chunks.push(chunk.subarray(0, remaining))
      this.bytes = this.maxBytes
      this.truncated = true
      return
    }
    this.chunks.push(chunk)
    this.bytes += chunk.length
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString('utf8')
    return this.truncated ? `${text}\n[orca ssh cli] output truncated\n` : text
  }
}
