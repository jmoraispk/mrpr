import { useState, type FormEvent } from 'react'

import { platform } from '../platform/platform'
import { redirectUri, signIn } from './auth'
import { siteConfig } from './config'
import type { Server } from './server'
import { validateApplicationId } from './applicationId'
import { rememberHost } from './servers'

function Copyable({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <span className="setup-copyable">
      <code>{value}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          // A refused copy (permissions, insecure page) must not fail silently.
          const copy = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('no clipboard'))
          void copy.then(
            () => setState('copied'),
            () => setState('failed'),
          )
        }}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy'}
      </button>
    </span>
  )
}

const tutorial = (step: number) => `${import.meta.env.BASE_URL}tutorial/step-${step}.png`

export function SetupView({
  server,
  replacing,
  directoryDown = false,
  onBack,
}: {
  server: Server
  /** The directory's broken id, when this setup replaces it. */
  replacing?: string
  /** The directory could not be asked, so this may not be the first setup. */
  directoryDown?: boolean
  onBack: () => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const redirect = redirectUri()

  async function submit(event: FormEvent) {
    event.preventDefault()
    const result = validateApplicationId(value)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    const site = { host: server.host, clientId: result.clientId }
    await rememberHost(platform().store, site)
    // A fresh setup is shared once it works. Setting up again only fixes this
    // browser: the directory entry is never replaced through the API.
    await signIn(
      site,
      window.location.hash || '#/',
      siteConfig().scopes,
      undefined,
      replacing ? {} : { publish: {} },
    )
  }

  return (
    <main className="setup">
      <header className="setup-intro">
        <h1>
          {replacing
            ? `The saved setup for ${server.host} no longer works`
            : directoryDown
              ? `Set up Mr. PR for ${server.host}`
              : "Congratulations, you're the first person in your organization to use Mr. PR!"}
        </h1>
        {directoryDown ? (
          <p>
            We couldn't check whether someone at your organization already set
            up Mr. PR. If a colleague did, ask them for the Application ID and
            paste it in step 3; otherwise, three steps, under a minute.
          </p>
        ) : (
          <p>
            To keep Mr. PR 100% private, add it as an application on your own
            GitLab server. Three steps, under a minute.
          </p>
        )}
      </header>
      <ol className="setup-steps">
        <li className="setup-step">
          <a href={tutorial(1)} target="_blank" rel="noreferrer">
            <img src={tutorial(1)} alt="GitLab's Applications page with the Add new application button marked" />
          </a>
          <h2>
            <span className="setup-number">1</span> Open your Applications page and click
            "Add new application"
          </h2>
          <a className="setup-open" href={`${server.origin}/oauth/applications`} target="_blank" rel="noreferrer">
            Open {server.host} applications ↗
          </a>
        </li>
        <li className="setup-step">
          <a href={tutorial(2)} target="_blank" rel="noreferrer">
            <img src={tutorial(2)} alt="The new application form with each field to fill in marked" />
          </a>
          <h2>
            <span className="setup-number">2</span> Fill in these values, then click "Save application"
          </h2>
          <dl className="setup-values">
            <dt>Name</dt>
            <dd><Copyable label="Name" value="Mr. PR" /></dd>
            <dt>Redirect URI</dt>
            <dd><Copyable label="Redirect URI" value={redirect} /></dd>
            <dt>Confidential</dt>
            <dd><strong>Untick it</strong></dd>
            <dt>Scopes</dt>
            <dd>
              Tick <code>api</code>
            </dd>
          </dl>
        </li>
        <li className="setup-step">
          <a href={tutorial(3)} target="_blank" rel="noreferrer">
            <img src={tutorial(3)} alt="The saved application page with the Application ID's copy button marked and the Secret crossed out" />
          </a>
          <h2>
            <span className="setup-number">3</span> Copy the Application ID (not the Secret) and paste it here
          </h2>
          <form className="setup-form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="application-id">Application ID</label>
            <p className="setup-hint">
              It's at the top of GitLab's page, labelled "Application ID". The
              Secret below it is not what Mr. PR needs.
            </p>
            <input
              id="application-id"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {error ? <p className="signin-notice" role="alert">{error}</p> : null}
            <button className="signin-button" type="submit">Sign in</button>
          </form>
        </li>
      </ol>
      <button className="setup-back" type="button" onClick={onBack}>
        ← Use a different link
      </button>
    </main>
  )
}
