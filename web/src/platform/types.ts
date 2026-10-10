import type { DeltaMessage, DeltaResponse } from '../extension/messages'
import type { HostConfig } from '../extension/hosts'
import type { GitLabClient } from '../gitlab/client'

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
  /** Keys changed by this tab or another; returns an unsubscribe. */
  subscribe(listener: (keys: string[]) => void): () => void
}

export interface Platform {
  store: KeyValueStore
  /** True where the user pastes a token (the extension). */
  needsToken: boolean
  /** A ready client for a configured host; throws a coded `GitLabError`. */
  clientFor(host: HostConfig): Promise<GitLabClient>
  /** The extension saves a token; the site starts a sign-in redirect. */
  connectHost(input: {
    host: string
    apiBase: string
    token?: string
  }): Promise<HostConfig | 'redirecting'>
  /** Forget a host: the extension drops its token, the site signs out. */
  disconnectHost(id: string): Promise<void>
  /** Toolbar badge in the extension; tab icon dot on the site. */
  showUnread(count: number): Promise<void>
  /** Deliver a hub or review op to wherever the router runs. */
  send(message: DeltaMessage): Promise<DeltaResponse>
  /** Extension only: per-host browser permission. */
  hasHostAccess?(host: string): Promise<boolean>
  requestHostAccess?(host: string): Promise<boolean>
  /** Extension development builds only. */
  reload?(): void
  /** Site only: send the user back through sign-in, returning to this page. */
  reauthenticate?(): Promise<void>
}
