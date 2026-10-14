import { useEffect, useRef, useState } from 'react'

import { platform } from '../platform/platform'
import { AUTH_KEY, canPost, signIn, signInForPosting } from './auth'
import type { SiteConfig } from './config'
import { Modal } from './Modal'
import { pendingWriteAccess, settleWriteAccess, subscribeWriteAccess } from './writeAccess'

type Stage = 'ask' | 'waiting' | 'blocked'

const openPostingWindow = () =>
  window.open('about:blank', 'mrpr-allow-posting', 'popup,width=600,height=700')

/** Asks once per server before the first post, and lets the post through when GitLab says yes. */
export function WriteAccessGate({
  config,
  openWindow = openPostingWindow,
}: {
  config: SiteConfig
  openWindow?: () => Window | null
}) {
  const [hosts, setHosts] = useState(pendingWriteAccess)
  const [stage, setStage] = useState<Stage>('ask')
  const popup = useRef<Window | null>(null)
  useEffect(() => subscribeWriteAccess(() => setHosts(pendingWriteAccess())), [])
  const host = hosts[0] ?? null
  // Each server's question starts from the beginning.
  useEffect(() => setStage('ask'), [host])
  // While GitLab's window is open: done once the stored sign-in may post,
  // refused if the window closes without it.
  useEffect(() => {
    if (stage !== 'waiting' || !host) return
    const check = async () => {
      if (await canPost(host)) settleWriteAccess(host, true)
    }
    const stop = platform().store.subscribe((keys) => {
      if (keys.includes(AUTH_KEY)) void check()
    })
    const timer = window.setInterval(() => {
      if (!popup.current?.closed) return
      void canPost(host).then((granted) => settleWriteAccess(host, granted))
    }, 500)
    return () => {
      stop()
      window.clearInterval(timer)
    }
  }, [stage, host])

  if (!host) return null
  const site = config.hosts.find((value) => value.host === host)
  const refuse = () => settleWriteAccess(host, false)
  function allow() {
    // Opened inside the click, so pop-up blockers let it through.
    const opened = site ? openWindow() : null
    if (!opened || !site) {
      setStage('blocked')
      return
    }
    popup.current = opened
    setStage('waiting')
    void signInForPosting(site, opened)
  }

  return (
    <Modal label="Allow posting" onCancel={refuse}>
      {stage === 'blocked' ? (
        <>
          <p>
            Your browser blocked the GitLab window. Allow pop-ups for this site and try again, or
            sign in again with posting allowed (anything you've typed here will be lost).
          </p>
          <div className="q-modal-actions">
            <button type="button" className="q-primary" onClick={allow}>
              Try again
            </button>
            <button
              type="button"
              onClick={() => site && void signIn(site, window.location.hash || '#/', 'api')}
            >
              Sign in again
            </button>
            <button type="button" onClick={refuse}>
              Not now
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            GitLab needs your OK before Mr. PR can post as you on <strong>{host}</strong>.
          </p>
          {stage === 'waiting' ? <p className="q-modal-note">Waiting for GitLab…</p> : null}
          <div className="q-modal-actions">
            <button type="button" className="q-primary" onClick={allow} disabled={stage === 'waiting'}>
              Allow
            </button>
            <button type="button" onClick={refuse}>
              Not now
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
