import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

export const server = setupServer(
  http.get('/api/config', () =>
    HttpResponse.json({
      host: 'gitlab.example.com',
      project: 'platform/delta-review',
      mr_iid: 42,
    }),
  ),
  http.get('/api/mr', () =>
    HttpResponse.json({
      iid: 42,
      title: 'Improve parser errors',
      web_url:
        'https://gitlab.example.com/platform/delta-review/-/merge_requests/42',
      state: 'opened',
      source_branch: 'parser-errors',
      target_branch: 'main',
    }),
  ),
  http.get('/api/diffs', () =>
    HttpResponse.json([
      {
        old_path: 'src/parser.py',
        new_path: 'src/parser.py',
        diff: '@@ -1 +1 @@\n-old\n+new',
        new_file: false,
        renamed_file: false,
        deleted_file: false,
        collapsed: false,
        too_large: false,
      },
    ]),
  ),
  http.get('/api/discussions', () => HttpResponse.json([])),
  // The site reports each user's first visit; tests never care about the answer.
  http.post('*/api/users/', () => HttpResponse.json({ ok: true, firstSeen: '2026-10-14T00:00:00.000Z' })),
)
