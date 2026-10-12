import { expect, test } from 'vitest'

import { EXAMPLE_MR_URL, parseServer } from './server'

const ok = (host: string) => ({ ok: true, server: { host, origin: `https://${host}` } })

test('a merge request link gives its server', () => {
  expect(parseServer('https://gitlab-master.nvidia.com/g/p/-/merge_requests/5606/diffs#note_1')).toEqual(
    ok('gitlab-master.nvidia.com'),
  )
  expect(parseServer('  https://GitLab.Example.com/a/b/-/merge_requests/1?x=y  ')).toEqual(
    ok('gitlab.example.com'),
  )
})

test('a bare address works too', () => {
  expect(parseServer('gitlab.com')).toEqual(ok('gitlab.com'))
  expect(parseServer('https://gitlab.example.com')).toEqual(ok('gitlab.example.com'))
})

test('plain http is refused with a reason', () => {
  expect(parseServer('http://gitlab.example.com/x')).toEqual({
    ok: false,
    message: 'Mr. PR only talks to GitLab over https. Paste the https:// link.',
  })
})

test('a port is refused with a reason', () => {
  expect(parseServer('https://gitlab.example.com:8443/x')).toMatchObject({ ok: false })
})

test('anything else asks for a merge request link', () => {
  for (const junk of ['', 'hello', 'ftp://x.y', 'https://localhost/x']) {
    expect(parseServer(junk)).toEqual({
      ok: false,
      message: `Paste a link to a merge request, like ${EXAMPLE_MR_URL}.`,
    })
  }
})
