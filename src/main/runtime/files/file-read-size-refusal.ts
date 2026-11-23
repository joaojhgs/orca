import { FileReadCapExceededError } from '../../ssh/ssh-filesystem-stream-reader'

export function rethrowSshFileReadLimit(error: unknown): never {
  if (error instanceof FileReadCapExceededError) {
    throw new Error('file_too_large')
  }
  throw error
}
