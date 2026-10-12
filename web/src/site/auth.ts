import { hostIdFor, removeHost, saveHost } from '../extension/hosts'
import { GitLabClient } from '../gitlab/client'
import { GitLabError } from '../gitlab/errors'
import { updateInbox } from '../inbox/store'
import { withLock } from '../platform/locks'
import { platform } from '../platform/platform'
import type { SiteConfig, SiteHost } from './config'
import { publishToDirectory } from './servers'

/** Per-host OAuth tokens, in the platform store (localStorage on the site). */
export const AUTH_KEY = 'auth'
/** The in-flight sign-in, in sessionStorage: it must not outlive the tab. */
export const PENDING_KEY = 'delta:pendingSignIn'
/** Refresh this long before expiry, so no request goes out with a dying token. */
const REFRESH_MARGIN_MS = 60_000

interface HostAuth {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface Pending {
  host: string
  /** Carried so a host learned in this tab completes without a config entry. */
  clientId: string
  state: string
  verifier: string
  returnTo: string
  /** Set when the id was pasted in setup: share it once sign-in works. */
  publish?: { replaces?: string }
}

export type AuthFailure = 'cancelled' | 'no_pending' | 'state_mismatch' | 'exchange_failed'

export class AuthError extends Error {
  readonly reason: AuthFailure

  constructor(reason: AuthFailure, message: string) {
    super(message)
    this.name = 'AuthError'
    this.reason = reason
  }
}

function base64Url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(48)))
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return base64Url(new Uint8Array(digest))
}

/** Where the app lives under the site: the landing page owns the root. */
export const APP_PATH = 'app/'

/** The app's own URL: one registered redirect URI per origin. */
export function redirectUri(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${APP_PATH}`
}

export async function signIn(
  site: SiteHost,
  returnTo: string,
  scopes = 'api',
  navigate: (url: string) => void = (url) => window.location.assign(url),
  options: { publish?: { replaces?: string } } = {},
): Promise<void> {
  const pending: Pending = {
    host: site.host,
    clientId: site.clientId,
    publish: options.publish,
    state: randomString(),
    verifier: randomString(),
    returnTo,
  }
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  const url = new URL(`https://${site.host}/oauth/authorize`)
  url.search = new URLSearchParams({
    client_id: site.clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes,
    state: pending.state,
    code_challenge: await pkceChallenge(pending.verifier),
    code_challenge_method: 'S256',
  }).toString()
  navigate(url.toString())
}

async function readAll(): Promise<Record<string, HostAuth>> {
  return (await platform().store.get<Record<string, HostAuth>>(AUTH_KEY)) ?? {}
}

/** Hosts holding a stored session, whether or not its token is still fresh. */
export async function sessionHosts(): Promise<string[]> {
  return Object.keys(await readAll())
}

async function write(host: string, auth: HostAuth | null): Promise<void> {
  const all = await readAll()
  if (auth) all[host] = auth
  else delete all[host]
  await platform().store.set({ [AUTH_KEY]: all })
}

/** How long a token request may take before it counts as GitLab being down. */
const TOKEN_TIMEOUT_MS = 15_000

type TokenPayload = { access_token: string; refresh_token: string; expires_in: number }

/**
 * `rejected`: GitLab refused the grant (400/401), so it will never work again.
 * `unavailable`: no answer, a timeout, or a server-side failure; worth a retry.
 */
type TokenResult =
  | { ok: true; token: TokenPayload }
  | { ok: false; failure: 'rejected' | 'unavailable' }

async function requestToken(
  host: string,
  body: Record<string, string>,
): Promise<TokenResult> {
  try {
    const response = await fetch(`https://${host}/oauth/token`, {
      method: 'POST',
      // A form body keeps this a CORS "simple" request.
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
    if (response.ok) return { ok: true, token: await response.json() }
    return {
      ok: false,
      failure:
        response.status === 400 || response.status === 401 ? 'rejected' : 'unavailable',
    }
  } catch {
    return { ok: false, failure: 'unavailable' }
  }
}

function toAuth(
  token: TokenPayload,
  now: number,
): HostAuth {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: now + token.expires_in * 1000,
  }
}

export async function completeSignIn(
  url: URL,
  config: SiteConfig,
): Promise<{ returnTo: string }> {
  const raw = sessionStorage.getItem(PENDING_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  if (!raw) {
    throw new AuthError(
      'no_pending',
      'That sign-in link has already been used or came from another tab. Sign in again.',
    )
  }
  const pending = JSON.parse(raw) as Pending
  if (url.searchParams.get('state') !== pending.state) {
    throw new AuthError('state_mismatch', 'The sign-in response did not match. Sign in again.')
  }
  if (url.searchParams.has('error')) {
    throw new AuthError('cancelled', 'Sign-in was cancelled on GitLab.')
  }
  const site =
    config.hosts.find((value) => value.host === pending.host) ??
    (pending.clientId ? { host: pending.host, clientId: pending.clientId } : undefined)
  const code = url.searchParams.get('code')
  const result =
    site && code
      ? await requestToken(site.host, {
          grant_type: 'authorization_code',
          client_id: site.clientId,
          code,
          code_verifier: pending.verifier,
          redirect_uri: redirectUri(),
        })
      : null
  if (!site || !result?.ok) {
    throw new AuthError('exchange_failed', 'GitLab did not complete the sign-in. Try again.')
  }
  const auth = toAuth(result.token, Date.now())
  await write(site.host, auth)
  const apiBase = `https://${site.host}/api/v4`
  const user = await new GitLabClient(apiBase, async () => auth.accessToken).request<{
    id: number
    username: string
  }>('GET', '/user')
  await saveHost({
    id: hostIdFor(site.host),
    host: hostIdFor(site.host),
    apiBase,
    userId: user.id,
    username: user.username,
  })
  if (pending.publish) {
    void publishToDirectory(site.host, site.clientId, pending.publish.replaces)
  }
  return { returnTo: pending.returnTo }
}

function signedOut(host: string): GitLabError {
  return new GitLabError(401, `Sign in to ${host} again.`, 'signed_out')
}

export async function accessToken(
  site: SiteHost,
  now: () => number = Date.now,
): Promise<string> {
  const current = (await readAll())[site.host]
  if (!current) throw signedOut(site.host)
  if (current.expiresAt - now() > REFRESH_MARGIN_MS) return current.accessToken

  // GitLab rotates the refresh token on every use, so exactly one caller may
  // spend it. The rest wait here, then find the rotated pair already stored.
  const token = await withLock(`delta-auth-${site.host}`, async () => {
    const fresh = (await readAll())[site.host]
    if (!fresh) throw signedOut(site.host)
    if (fresh.expiresAt - now() > REFRESH_MARGIN_MS) return fresh.accessToken
    const next = await requestToken(site.host, {
      grant_type: 'refresh_token',
      client_id: site.clientId,
      refresh_token: fresh.refreshToken,
      redirect_uri: redirectUri(),
    })
    if (!next.ok && next.failure === 'unavailable') {
      // Asleep, off the VPN, or GitLab having a moment: keep the session so
      // the next poll can try again, rather than signing everyone out.
      throw new GitLabError(
        503,
        'GitLab could not be reached to renew your sign-in.',
        'gitlab_unavailable',
      )
    }
    if (!next.ok) {
      await write(site.host, null)
      throw signedOut(site.host)
    }
    const auth = toAuth(next.token, now())
    await write(site.host, auth)
    return auth.accessToken
  })
  if (token === undefined) throw signedOut(site.host)
  return token
}

export async function signOut(site: SiteHost): Promise<void> {
  const current = (await readAll())[site.host]
  if (current) {
    try {
      await fetch(`https://${site.host}/oauth/revoke`, {
        method: 'POST',
        body: new URLSearchParams({ client_id: site.clientId, token: current.accessToken }),
      })
    } catch {
      // Best effort: the token expires within two hours regardless.
    }
  }
  await write(site.host, null)
  const id = hostIdFor(site.host)
  await removeHost(id)
  await updateInbox((state) => {
    const hosts = { ...state.hosts }
    delete hosts[id]
    return { hosts }
  })
}
