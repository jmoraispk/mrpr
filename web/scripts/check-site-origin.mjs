import { pathToFileURL } from 'node:url'

/**
 * The site keeps GitLab sign-in tokens in localStorage, which is shared by
 * everything served from the same origin. A GitHub Pages *project* site lives
 * at `https://<owner>.github.io/<repo>/`, whose origin every other Pages site
 * of that account shares, so any script on any of them could read the tokens.
 * The deploy therefore refuses unless the site has an origin of its own: a
 * custom domain, or the root site of an account or organisation dedicated to
 * Delta.
 *
 * Returns why `origin` is unsafe for `repository` (`owner/name`), or null.
 */
export function originProblem(origin, repository) {
  if (!origin?.trim()) {
    return (
      'Set the DELTA_SITE_ORIGIN repository variable to the origin the site is ' +
      'served from. It must be used by nothing else; see docs/site-setup.md.'
    )
  }
  let url
  try {
    url = new URL(origin.trim())
  } catch {
    return `DELTA_SITE_ORIGIN must be an https origin, such as https://delta.example.com.`
  }
  if (url.protocol !== 'https:') {
    return `DELTA_SITE_ORIGIN must be an https origin, such as https://delta.example.com.`
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    return `DELTA_SITE_ORIGIN is an origin only, with no path: ${url.origin}`
  }
  const [owner, name] = repository.toLowerCase().split('/')
  const host = url.hostname.toLowerCase()
  if (host === `${owner}.github.io` && name !== `${owner}.github.io`) {
    return (
      `${url.origin} is shared with every other GitHub Pages site of ${owner}, ` +
      'and any of them could read sign-in tokens stored by this one. Use a ' +
      'custom domain or a dedicated account; see docs/site-setup.md.'
    )
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problem = originProblem(
    process.env.DELTA_SITE_ORIGIN ?? '',
    process.env.GITHUB_REPOSITORY ?? '',
  )
  if (problem) {
    console.error(`::error::${problem}`)
    process.exit(1)
  }
}
