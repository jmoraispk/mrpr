import { GitLabError } from '../gitlab/errors'

/**
 * Posting rights, asked for the first time something is posted. A write waits
 * here while the WriteAccessGate asks the user; every write to the same server
 * shares one question.
 */
export const WRITE_DENIED = 'write_access_denied'

interface Waiter {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

const waiting = new Map<string, Waiter>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((listener) => listener())

export function requestWriteAccess(host: string): Promise<void> {
  let waiter = waiting.get(host)
  if (!waiter) {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((yes, no) => {
      resolve = yes
      reject = no
    })
    waiter = { promise, resolve, reject }
    waiting.set(host, waiter)
    changed()
  }
  return waiter.promise
}

/** Servers waiting for an answer, in the order they asked. */
export function pendingWriteAccess(): string[] {
  return [...waiting.keys()]
}

export function settleWriteAccess(host: string, granted: boolean): void {
  const waiter = waiting.get(host)
  if (!waiter) return
  waiting.delete(host)
  if (granted) waiter.resolve()
  else waiter.reject(new GitLabError(403, 'Posting needs your OK in GitLab.', WRITE_DENIED))
  changed()
}

export function subscribeWriteAccess(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
