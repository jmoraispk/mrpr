import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Hub } from './hub/Hub'
import { createExtensionPlatform } from './platform/extension'
import { installPlatform } from './platform/platform'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})

installPlatform(createExtensionPlatform())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Hub />
    </QueryClientProvider>
  </StrictMode>,
)
