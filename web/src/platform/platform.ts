import type { Platform } from './types'

let current: Platform | null = null

/**
 * Each entrypoint installs its platform once, before rendering or listening:
 * the extension's worker and hub page install the extension platform, the
 * site installs the site platform, and tests install whichever they exercise.
 * Shared code never imports `webextension-polyfill`; it goes through here.
 */
export function installPlatform(next: Platform): void {
  current = next
}

export function platform(): Platform {
  if (!current) throw new Error('No platform installed')
  return current
}
