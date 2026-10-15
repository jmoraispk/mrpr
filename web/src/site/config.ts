export interface SiteHost {
  host: string
  /** OAuth application id. Public by design under PKCE; not a secret. */
  clientId: string
}

export interface SiteConfig {
  hosts: SiteHost[]
  /** `read_api`: posting asks for `api` the first time it is needed. The built-in host is asked for `api` at once (see signIn). */
  scopes: string
}

const DEFAULT_HOST = 'gitlab-master.nvidia.com'

/** Read at build time from Vite env. No client id means not configured. */
export function siteConfig(
  env: Record<string, string | undefined> = import.meta.env,
): SiteConfig {
  const clientId = env.VITE_GITLAB_CLIENT_ID?.trim() ?? ''
  const host = env.VITE_GITLAB_HOST?.trim() || DEFAULT_HOST
  return { hosts: clientId ? [{ host, clientId }] : [], scopes: 'read_api' }
}
