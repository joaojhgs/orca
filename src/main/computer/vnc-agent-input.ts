import type { VncAgentAction } from '../../shared/vnc-agent-contract'
import type { VncAgentReader } from './vnc-agent-reader'

const KEYS: Readonly<Record<string, number>> = {
  return: 0xff0d,
  enter: 0xff0d,
  escape: 0xff1b,
  esc: 0xff1b,
  tab: 0xff09,
  backspace: 0xff08,
  delete: 0xffff,
  space: 0x20,
  left: 0xff51,
  up: 0xff52,
  right: 0xff53,
  down: 0xff54,
  home: 0xff50,
  end: 0xff57,
  pageup: 0xff55,
  pagedown: 0xff56,
  insert: 0xff63,
  shift: 0xffe1,
  ctrl: 0xffe3,
  control: 0xffe3,
  cmdorctrl: 0xffe3,
  alt: 0xffe9,
  option: 0xffe9,
  super: 0xffeb,
  meta: 0xffeb,
  win: 0xffeb,
  cmd: 0xffeb
}

function keysym(key: string): number {
  const known = KEYS[key.toLowerCase()]
  if (known) {
    return known
  }
  const fn = /^f([1-9]|1[0-2])$/i.exec(key)
  if (fn) {
    return 0xffbd + Number(fn[1])
  }
  if ([...key].length !== 1) {
    throw new Error('Unknown VNC key')
  }
  const code = key.codePointAt(0)
  if (code === undefined || code < 32 || (code >= 0xd800 && code <= 0xdfff)) {
    throw new Error('Invalid VNC key')
  }
  return code <= 255 ? code : 0x01000000 + code
}

export function vncAgentInputFrames(
  action: VncAgentAction,
  width: number,
  height: number
): Buffer[] {
  const frames: Buffer[] = []
  const pointer = (mask: number, x: number, y: number) => {
    if (x >= width || y >= height) {
      throw new Error('VNC coordinates are outside the desktop')
    }
    const frame = Buffer.from([5, mask, 0, 0, 0, 0])
    frame.writeUInt16BE(x, 2)
    frame.writeUInt16BE(y, 4)
    frames.push(frame)
  }
  const key = (symbol: number, down: boolean) => {
    const frame = Buffer.from([4, down ? 1 : 0, 0, 0, 0, 0, 0, 0])
    frame.writeUInt32BE(symbol, 4)
    frames.push(frame)
  }
  if (action.kind === 'move') {
    pointer(0, action.x, action.y)
  } else if (action.kind === 'click' || action.kind === 'scroll') {
    const mask =
      action.kind === 'click'
        ? { left: 1, middle: 2, right: 4 }[action.button]
        : { up: 8, down: 16, left: 32, right: 64 }[action.direction]
    const count = action.kind === 'click' ? action.count : action.steps
    for (let i = 0; i < count; i++) {
      pointer(mask, action.x, action.y)
      pointer(0, action.x, action.y)
    }
  } else if (action.kind === 'drag') {
    pointer(0, action.x, action.y)
    pointer(1, action.x, action.y)
    for (let i = 1; i <= 12; i++) {
      pointer(
        1,
        Math.round(action.x + ((action.toX - action.x) * i) / 12),
        Math.round(action.y + ((action.toY - action.y) * i) / 12)
      )
    }
    pointer(0, action.toX, action.toY)
  } else if (action.kind === 'key') {
    const parts = action.key === '+' ? ['+'] : action.key.split('+')
    if (parts.length > 5 || parts.some((part) => !part.trim())) {
      throw new Error('Invalid VNC key chord')
    }
    const symbols = parts.map((part) => keysym(part.trim()))
    for (const symbol of symbols) {
      key(symbol, true)
    }
    for (const symbol of symbols.toReversed()) {
      key(symbol, false)
    }
  } else if (action.kind === 'type') {
    for (const char of action.text) {
      const symbol = char === '\n' ? 0xff0d : char === '\t' ? 0xff09 : keysym(char)
      key(symbol, true)
      key(symbol, false)
    }
  }
  return frames
}

export async function sendVncAgentInput(
  reader: VncAgentReader,
  action: VncAgentAction,
  width: number,
  height: number
): Promise<void> {
  const frames = vncAgentInputFrames(action, width, height)
  if (frames.length) {
    await reader.write(Buffer.concat(frames))
  }
}
