# Roadmap: later features

Ideas agreed for later, so they are not lost. Not scheduled.

## Paid features

- **Remove the "via Mr. PR" signature.** Every comment Mr. PR posts (replies,
  requests for changes, nudges, review comments) ends with `*— via Mr. PR*`. A
  setting to turn it off, for paying users.
- **Team digest.** What's waiting on whom, posted to Slack or Teams every
  morning. Needs a backend.
- **Rules for agent-written MRs.** Label what agents wrote; e.g. require a second
  human reviewer above 500 lines, fold agent dependency bumps, rank agent MRs
  below human ones.
- **Every account, one inbox.** gitlab.com, a work instance and a client's,
  sorted together (partly there: several hosts already work).

## Product

- **Projects synced across devices.** Projects live in one browser today
  (with JSON export/import); an account backend would sync them.
- **Ranking polish.** Review-time estimates tuned per person, risky-path lists
  per repository, a daily review budget.
- **Giant MRs.** Every file of a 300-file MR, grouped by folder, generated and
  lock files folded.
- **GitHub.** Sign in with GitHub; needs a small token-exchange function.
- **Native "request changes" state** where GitLab exposes it (newer than
  17.7), in addition to the tagged comment.
