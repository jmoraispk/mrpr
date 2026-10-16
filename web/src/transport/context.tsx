import { createContext, useContext, type ReactNode } from 'react'

import type { MrprTransport } from './types'

const TransportContext = createContext<MrprTransport | null>(null)

export function TransportProvider({
  transport,
  children,
}: {
  transport: MrprTransport
  children: ReactNode
}) {
  return (
    <TransportContext.Provider value={transport}>
      {children}
    </TransportContext.Provider>
  )
}

export function useTransport(): MrprTransport {
  const transport = useContext(TransportContext)
  if (!transport) {
    throw new Error('useTransport requires a TransportProvider ancestor')
  }
  return transport
}
