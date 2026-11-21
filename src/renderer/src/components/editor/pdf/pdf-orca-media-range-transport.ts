import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readOrcaMediaRange } from '@/runtime/files/reads/orca-media-range-read'

/**
 * pdf.js only fetches ranges over http(s); this reads an orca-media grant's ranges over IPC, which
 * main answers only for the renderer that minted it, so the scheme needs no fetch or CORS.
 */
export function createOrcaMediaRangeTransport(
  url: string,
  length: number,
  onFailure: (error: unknown) => void
): PDFDataRangeTransport {
  let aborted = false
  class OrcaMediaRangeTransport extends PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      void readOrcaMediaRange(url, begin, end, () => aborted)
        .then((chunk) => {
          if (!aborted) {
            this.onDataRange(begin, chunk)
          }
        })
        .catch((error: unknown) => {
          // pdf.js has no range-failure callback; without this it would wait forever.
          if (!aborted) {
            onFailure(error)
          }
        })
    }

    override abort(): void {
      aborted = true
    }
  }
  return new OrcaMediaRangeTransport(length, null)
}
