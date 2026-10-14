import { useStored } from '../queue/state'
import { Modal } from './Modal'

const UNLOCKED = [
  'Unlimited MRs/PRs',
  'Unlimited accounts and repos',
  'One-click nudges',
  'Review budget and estimates',
]

/** Once per browser, after the first sign-in. */
export function WelcomeDialog() {
  // Taken as welcomed until the store says otherwise, so it never flashes.
  const [welcomed, setWelcomed] = useStored('welcomed', true, (stored) => stored === true)
  if (welcomed) return null
  const done = () => setWelcomed(true)
  return (
    <Modal label="Welcome" onCancel={done}>
      <h2 className="q-modal-title">Welcome to Mr. PR.</h2>
      <p>Everything is unlocked during early access:</p>
      <ul className="q-modal-list">
        {UNLOCKED.map((feature) => (
          <li key={feature}>✓ {feature}</li>
        ))}
      </ul>
      <p>Something rough or missing? Hit Feedback anytime. We read every message.</p>
      <div className="q-modal-actions">
        <button type="button" className="q-primary" onClick={done} autoFocus>
          Start reviewing
        </button>
      </div>
    </Modal>
  )
}
