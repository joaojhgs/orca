export function parseAddedLineRanges(diff, { includeDeletionBoundaries = false } = {}) {
  const ranges = []
  const hunkPattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
  for (const line of diff.split(/\r?\n/)) {
    const match = hunkPattern.exec(line)
    if (!match) {
      continue
    }
    const start = Number.parseInt(match[1], 10)
    const count = match[2] === undefined ? 1 : Number.parseInt(match[2], 10)
    if (count > 0) {
      ranges.push({ start, end: start + count - 1 })
    } else if (includeDeletionBoundaries) {
      // A removed line can make the next line newly match a rule with surrounding context.
      ranges.push({ start: start + 1, end: start + 1 })
    }
  }
  return ranges
}

export function overlapsAddedLines(startLine, endLine, ranges) {
  return ranges.some((range) => startLine <= range.end && endLine >= range.start)
}
