import type { Platform } from './types'

let current: Platform | null = null

/**
 * Each entrypoint installs its platform once, before rendering: the site
 * installs the site platform, and tests install a fake one.
 */
export function installPlatform(next: Platform): void {
  current = next
}

export function platform(): Platform {
  if (!current) throw new Error('No platform installed')
  return current
}

/**
 * The platform, or null where none is installed: the CLI's single-review page
 * renders shared review components without one.
 */
export function currentPlatform(): Platform | null {
  return current
}
