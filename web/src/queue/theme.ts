import { useEffect, useState } from 'react'

import { platform } from '../platform/platform'

export type ThemeChoice = 'system' | 'light' | 'dark'
const THEME_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light'
  return choice
}

export function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme
}

/** Null where the environment cannot say (no matchMedia): light by default. */
function darkQuery(): MediaQueryList | null {
  return typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null
}

/** The site's light/dark preference: system by default, remembered per browser. */
export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>('system')
  const [prefersDark, setPrefersDark] = useState(() => darkQuery()?.matches ?? false)
  useEffect(() => {
    void platform()
      .store.get<ThemeChoice>(THEME_KEY)
      .then((stored) => {
        if (stored) setChoiceState(stored)
      })
    const media = darkQuery()
    if (!media) return
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  const theme = resolveTheme(choice, prefersDark)
  useEffect(() => applyTheme(theme), [theme])
  return {
    choice,
    theme,
    setChoice(next: ThemeChoice) {
      setChoiceState(next)
      applyTheme(resolveTheme(next, prefersDark))
      void platform().store.set({ [THEME_KEY]: next })
    },
  }
}
