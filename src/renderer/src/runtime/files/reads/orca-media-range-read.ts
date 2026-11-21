// Main's per-call bound for preview range reads; pdf.js may merge neighbouring chunks past it.
const PREVIEW_RANGE_READ_MAX_BYTES = 4 * 1024 * 1024

export async function readOrcaMediaRange(
  url: string,
  begin: number,
  end: number,
  isAborted: () => boolean = () => false
): Promise<Uint8Array> {
  const range = new Uint8Array(end - begin)
  let read = 0
  while (begin + read < end) {
    // A closed or reloaded viewer schedules no further pieces.
    if (isAborted()) {
      throw new Error('PDF range read cancelled')
    }
    const piece = await window.api.fs.readPreviewRange({
      url,
      offset: begin + read,
      length: Math.min(PREVIEW_RANGE_READ_MAX_BYTES, end - begin - read)
    })
    if (piece.byteLength === 0) {
      throw new Error('PDF ended before the requested range')
    }
    range.set(piece, read)
    read += piece.byteLength
  }
  return range
}
