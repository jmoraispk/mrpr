export interface Server {
  host: string
  origin: string
}

export type ParseResult =
  | { ok: true; server: Server }
  | { ok: false; message: string }

export const EXAMPLE_MR_URL =
  'https://gitlab.example.com/group/project/-/merge_requests/1'

const UNRECOGNISED = `Paste a link to a merge request, like ${EXAMPLE_MR_URL}.`

/**
 * The GitLab server behind whatever the visitor pasted: a merge request link
 * (any path, query or fragment), any other GitLab URL, or a bare hostname.
 */
export function parseServer(input: string): ParseResult {
  const text = input.trim()
  if (!text) return { ok: false, message: UNRECOGNISED }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, message: UNRECOGNISED }
  }
  if (url.protocol === 'http:') {
    return {
      ok: false,
      message: 'Mr. PR only talks to GitLab over https. Paste the https:// link.',
    }
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'https:' || !host.includes('.')) {
    return { ok: false, message: UNRECOGNISED }
  }
  if (url.port) {
    return {
      ok: false,
      message: 'Mr. PR needs your GitLab address without a port number.',
    }
  }
  return { ok: true, server: { host, origin: `https://${host}` } }
}
