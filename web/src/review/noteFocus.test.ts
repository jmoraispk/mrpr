import { afterEach, expect, test, vi } from 'vitest'

import type { DiffFile, Discussion } from '../api/types'
import { focusThread, locateNote } from './noteFocus'

const file = (path: string): DiffFile => ({
  old_path: path,
  new_path: path,
  diff: '@@ -1 +1 @@\n-old\n+new',
  new_file: false,
  renamed_file: false,
  deleted_file: false,
  collapsed: false,
  too_large: false,
})

const files = [file('a.py'), file('src/parser.py')]

const inline: Discussion = {
  id: 'inline-1',
  notes: [
    {
      id: 7,
      body: 'Here',
      position: { old_path: 'src/parser.py', new_path: 'src/parser.py', new_line: 1 },
    },
    { id: 8, body: 'Reply' },
  ],
}
const general: Discussion = { id: 'general-1', notes: [{ id: 5, body: 'Overall' }] }
const outdated: Discussion = {
  id: 'old-1',
  notes: [
    {
      id: 9,
      body: 'Gone',
      position: { old_path: 'deleted.py', new_path: 'deleted.py', new_line: 3 },
    },
  ],
}
const discussions = [inline, general, outdated]

test('a positioned note is found in the file that shows it', () => {
  expect(locateNote(discussions, files, 8)).toEqual({
    kind: 'inline',
    discussionId: 'inline-1',
    fileIndex: 1,
  })
})

test('a note without a position is in the MR discussions', () => {
  expect(locateNote(discussions, files, 5)).toEqual({
    kind: 'general',
    discussionId: 'general-1',
  })
})

test('a note on a file no longer in the diff, or no note at all, is not found', () => {
  expect(locateNote(discussions, files, 9)).toBeNull()
  expect(locateNote(discussions, files, 999)).toBeNull()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

test('the thread is focused and flashed once it mounts', () => {
  vi.useFakeTimers()
  const cancel = focusThread('t1', { scroll: true })

  const thread = document.createElement('article')
  thread.dataset.discussionId = 't1'
  thread.tabIndex = -1
  document.body.append(thread)
  vi.advanceTimersByTime(60)

  expect(document.activeElement).toBe(thread)
  expect(thread).toHaveClass('thread-flash')
  vi.advanceTimersByTime(2_000)
  expect(thread).not.toHaveClass('thread-flash')
  cancel()
})

test('cancelling stops the wait', () => {
  vi.useFakeTimers()
  const cancel = focusThread('t2', { scroll: false })
  cancel()

  const thread = document.createElement('article')
  thread.dataset.discussionId = 't2'
  thread.tabIndex = -1
  document.body.append(thread)
  vi.advanceTimersByTime(200)

  expect(document.activeElement).not.toBe(thread)
})

test('a note on a file whose diff is not shown is not found', () => {
  for (const hidden of [{ collapsed: true }, { too_large: true }]) {
    const withHidden = [file('a.py'), { ...file('src/parser.py'), ...hidden }]
    expect(locateNote(discussions, withHidden, 8)).toBeNull()
  }
})

test('a thread that never mounts is reported, once', () => {
  // A positioned note whose line is outside every hunk has a file but no row.
  vi.useFakeTimers()
  const onMissing = vi.fn()
  focusThread('never', { scroll: false, onMissing })

  vi.advanceTimersByTime(7_900)
  expect(onMissing).not.toHaveBeenCalled()
  vi.advanceTimersByTime(200)
  expect(onMissing).toHaveBeenCalledTimes(1)
})

test('a thread that mounts is not reported missing', () => {
  vi.useFakeTimers()
  const onMissing = vi.fn()
  focusThread('t3', { scroll: false, onMissing })
  const thread = document.createElement('article')
  thread.dataset.discussionId = 't3'
  thread.tabIndex = -1
  document.body.append(thread)

  vi.advanceTimersByTime(10_000)

  expect(onMissing).not.toHaveBeenCalled()
})
