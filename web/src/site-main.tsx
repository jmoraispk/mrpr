import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/tokens.css'
import './index.css'
import { createLocalStore } from './platform/localStore'
import { createSitePlatform } from './platform/site'
import { installPlatform } from './platform/platform'
import { AuthError, completeSignIn } from './site/auth'
import { siteConfig } from './site/config'
import { loadCustomHosts, adoptSite } from './site/servers'
import { SiteApp } from './site/SiteApp'

const config = siteConfig()
const store = createLocalStore()

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

async function start(): Promise<void> {
  // Servers set up in this browser join the ones built in; never override a
  // built-in id, which the operator may rotate.
  const builtIn = new Set(config.hosts.map((site) => site.host))
  for (const site of await loadCustomHosts(store)) {
    if (!builtIn.has(site.host)) adoptSite(config, site)
  }
  installPlatform(createSitePlatform(config, store))
  const notice = await finishSignInIfReturning()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SiteApp config={config} notice={notice} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
