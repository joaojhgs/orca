export function pdfArtifactByteLength(content: string): number {
  if (
    !content.length ||
    content.length % 4 ||
    Buffer.from(content.slice(0, 12), 'base64').subarray(0, 5).toString() !== '%PDF-'
  ) {
    throw new Error('Invalid PDF artifact: expected canonical base64 PDF content')
  }
  for (let offset = 0; offset < content.length; offset += 64 * 1024) {
    const part = content.slice(offset, offset + 64 * 1024)
    if (
      Buffer.from(part, 'base64').toString('base64') !== part ||
      (offset + part.length < content.length && part.includes('='))
    ) {
      throw new Error('Invalid PDF artifact: expected canonical base64 PDF content')
    }
  }
  return (content.length / 4) * 3 - (content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0)
}

export function readPdfBase64Range(content: string, offset: number, length: number): Buffer {
  const start = Math.floor(offset / 3) * 4
  const end = Math.ceil((offset + length) / 3) * 4
  return Buffer.from(content.slice(start, end), 'base64').subarray(
    offset % 3,
    (offset % 3) + length
  )
}
