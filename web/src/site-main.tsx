import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import { createSitePlatform } from './platform/site'
import { installPlatform } from './platform/platform'
import { AuthError, completeSignIn } from './site/auth'
import { siteConfig } from './site/config'
import { SiteApp } from './site/SiteApp'

const config = siteConfig()
installPlatform(createSitePlatform(config))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
})

/** GitLab sends the user back here with `code`/`state`, or `error`. */
async function finishSignInIfReturning(): Promise<string | null> {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return null
  // Drop the one-time code from the address bar whatever happens next.
  history.replaceState(null, '', url.pathname)
  try {
    const { returnTo } = await completeSignIn(url, config)
    history.replaceState(null, '', `${url.pathname}${returnTo}`)
    return null
  } catch (error) {
    return error instanceof AuthError
      ? error.message
      : 'GitLab did not complete the sign-in. Try again.'
  }
}

void finishSignInIfReturning().then((notice) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SiteApp config={config} notice={notice} />
      </QueryClientProvider>
    </StrictMode>,
  )
})
