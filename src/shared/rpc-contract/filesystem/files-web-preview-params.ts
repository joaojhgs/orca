import { z } from 'zod'
import { FileOpen } from './files-target-params'
import { TerminalArtifactFile } from './files-terminal-artifact-params'
export const WebFilePreview = z.union([TerminalArtifactFile, FileOpen])
