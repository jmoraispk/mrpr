import type { DiffTheme } from './diffWorkerClient'

const LIGHT_QUERY = '(prefers-color-scheme: light)'

/** The app's chosen theme (<html data-theme>) when it has one, else the system's. */
export function preferredTheme(): DiffTheme {
  const chosen = document.documentElement.dataset.theme
  if (chosen === 'light' || chosen === 'dark') return chosen
  return typeof window.matchMedia === 'function' &&
    window.matchMedia(LIGHT_QUERY).matches
    ? 'light'
    : 'dark'
}

/** Follows the app's theme and the system's. Returns an unsubscribe function. */
export function watchTheme(onChange: (theme: DiffTheme) => void): () => void {
  const update = () => onChange(preferredTheme())
  const media =
    typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null
  media?.addEventListener('change', update)
  const observer = new MutationObserver(update)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => {
    media?.removeEventListener('change', update)
    observer.disconnect()
  }
}
