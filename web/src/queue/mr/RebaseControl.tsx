import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { MrOverview } from '../../gitlab/mrOverview'
import { createRuntimeTransport } from '../../transport/runtime'
import type { ReviewTarget } from '../../transport/types'

const POLL_MS = 3_000
const LIMIT_MS = 120_000

type State = 'idle' | 'rebasing' | 'done' | 'failed'

/** Rebase the source branch: shown only when GitLab says it's needed and you may push. */
export function RebaseControl({
  overview,
  target,
  compact = false,
}: {
  overview: MrOverview
  target: ReviewTarget
  /** Just the button, for the header. */
  compact?: boolean
}) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<State>(overview.rebaseInProgress ? 'rebasing' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const alive = useRef(true)
  // Polling belongs to this MR: it stops when the control goes away.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  if (!overview.canPush || (!overview.shouldBeRebased && state === 'idle')) return null

  async function start() {
    const transport = createRuntimeTransport(target)
    setError(null)
    try {
      await transport.rebase!()
    } catch (caught) {
      setState('failed')
      setError(caught instanceof Error ? caught.message : 'GitLab refused the rebase.')
      return
    }
    setState('rebasing')
    const startedAt = Date.now()
    const poll = async () => {
      const next = await transport.getOverview!().catch(() => null)
      if (!alive.current) return
      if (next && !next.rebaseInProgress) {
        setState('done')
        void queryClient.invalidateQueries({
          queryKey: ['overview', `${target.hostId}/${target.project}/${target.iid}`],
        })
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

  const action =
    state === 'rebasing' ? (
      <span className="mr-rebasing">Rebasing…</span>
    ) : state === 'done' ? (
      <span className="mr-rebased">Rebased</span>
    ) : (
      <button type="button" onClick={() => void start()}>
        Rebase
      </button>
    )
  if (compact) return action
  return (
    <section className="mr-rebase">
      <h3>Rebase</h3>
      {state === 'idle' || state === 'failed' ? <p>Behind {overview.targetBranch}</p> : null}
      {action}
      {error ? (
        <p className="mutation-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
