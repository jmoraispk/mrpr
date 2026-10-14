import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/tokens.css'
import './queue/queue.css'
import './queue/mr/mr.css'
import './queue/sidebar/sidebar.css'
import './index.css'
import { createLocalStore } from './platform/localStore'
import { createSitePlatform } from './platform/site'
import { installPlatform } from './platform/platform'
import { siteConfig } from './site/config'
import { loadCustomHosts, adoptSite } from './site/servers'
import { finishSignInIfReturning } from './site/returning'
import { SiteApp } from './site/SiteApp'

const config = siteConfig()
const store = createLocalStore()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false },
  },
})


async function start(): Promise<void> {
  // Servers set up in this browser join the ones built in; never override a
  // built-in id, which the operator may rotate.
  const builtIn = new Set(config.hosts.map((site) => site.host))
  for (const site of await loadCustomHosts(store)) {
    if (!builtIn.has(site.host)) adoptSite(config, site)
  }
  installPlatform(createSitePlatform(config, store))
  const { notice, closing } = await finishSignInIfReturning(new URL(window.location.href), config)
  // Going away (a posting window, or back to GitLab): render nothing, poll nothing.
  if (closing) return
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SiteApp config={config} notice={notice} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void start()
