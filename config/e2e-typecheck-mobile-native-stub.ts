// Type-only surface for native packages reached by the Electron E2E compiler.
export declare function getRandomBytes(length: number): Uint8Array<ArrayBuffer>

declare const storage: {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export default storage
