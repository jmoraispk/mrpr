import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import { createRuntimeTransport } from '../../transport/runtime'
import type { ReviewTarget } from '../../transport/types'

const POLL_MS = 3_000
const LIMIT_MS = 120_000

type State = 'idle' | 'rebasing' | 'done' | 'failed'

/** Rebase the source branch: shown only when GitLab says it's needed and you may push. */
export function RebaseControl({ overview, target }: { overview: MrOverview; target: ReviewTarget }) {
  const queryClient = useQueryClient()
  const transport = useMemo(() => createRuntimeTransport(target), [target])
  const overviewKey = ['overview', `${target.hostId}/${target.project}/${target.iid}`]
  const [state, setState] = useState<State>(overview.rebaseInProgress ? 'rebasing' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const alive = useRef(true)

  /** Check GitLab every few seconds until the rebase is over, for this MR only. */
  function follow(startedAt: number) {
    const poll = async () => {
      const next = await transport.getOverview!().catch(() => null)
      if (!alive.current) return
      if (next && !next.rebaseInProgress) {
        setState('done')
        void queryClient.invalidateQueries({ queryKey: overviewKey })
        return
      }
      if (Date.now() - startedAt >= LIMIT_MS) {
        setState('failed')
        setError('GitLab is still rebasing. Check again in a moment.')
        return
      }
      timer.current = window.setTimeout(() => void poll(), POLL_MS)
    }
    timer.current = window.setTimeout(() => void poll(), POLL_MS)
  }

  // Polling belongs to this MR: it stops when the control goes away. An MR
  // that is already rebasing when it opens is followed too.
  useEffect(() => {
    alive.current = true
    if (overview.rebaseInProgress) follow(Date.now())
    return () => {
      alive.current = false
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
    // Once per mount: the panel remounts this for each MR.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!overview.canPush || (!overview.shouldBeRebased && state === 'idle')) return null

  async function start() {
    setError(null)
    try {
      await transport.rebase!()
    } catch (caught) {
      if (!alive.current) return
      setState('failed')
      setError(caught instanceof Error ? caught.message : 'GitLab refused the rebase.')
      return
    }
    // The panel moved on while the request was on its way: nothing to follow here.
    if (!alive.current) return
    setState('rebasing')
    // Coming back to this MR should show the rebase, not the stale "Behind".
    void queryClient.invalidateQueries({ queryKey: overviewKey })
    follow(Date.now())
  }

  return (
    <section className="mr-rebase">
      <h3>Rebase</h3>
      {state === 'idle' || state === 'failed' ? <p>Behind {overview.targetBranch}</p> : null}
      {state === 'rebasing' ? (
        <span className="mr-rebasing">Rebasing…</span>
      ) : state === 'done' ? (
        <span className="mr-rebased">Rebased</span>
      ) : (
        <button type="button" onClick={() => void start()}>
          Rebase
        </button>
      )}
      {error ? (
        <p className="mutation-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
