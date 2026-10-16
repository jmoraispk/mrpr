import { beforeEach, expect, test } from 'vitest'

import type { Discussion } from '../api/types'
import {
  discussionRange,
  highlightDiscussionRanges,
} from './discussionRange'

const rangedDiscussion: Discussion = {
  id: 'range',
  notes: [{
    id: 1,
    body: 'Review this block',
    position: {
      old_path: 'a.py',
      new_path: 'a.py',
      old_line: null,
      new_line: 247,
      line_range: {
        start: {
          line_code: 'hash_0_218',
          type: 'new',
          old_line: null,
          new_line: 218,
        },
        end: {
          line_code: 'hash_0_247',
          type: 'new',
          old_line: null,
          new_line: 247,
        },
      },
    },
  }],
}

test('parses a GitLab multiline range on the new side', () => {
  expect(discussionRange(rangedDiscussion, {
    old_path: 'a.py',
    new_path: 'a.py',
  })).toEqual({
    side: 'new',
    startLine: 218,
    endLine: 247,
    anchorLine: 247,
    label: 'Lines +218–+247',
  })
})

test('normalizes reverse endpoint order', () => {
  const reversed: Discussion = {
    id: 'reversed',
    notes: [{
      id: 1,
      body: 'Review this block',
      position: {
        old_path: 'a.py',
        new_path: 'a.py',
        old_line: null,
        new_line: 999,
        line_range: {
          start: {
            line_code: 'hash_0_247',
            type: 'new',
            old_line: null,
            new_line: 247,
          },
          end: {
            line_code: 'hash_0_218',
            type: 'new',
            old_line: null,
            new_line: 218,
          },
        },
      },
    }],
  }

  expect(discussionRange(reversed, {
    old_path: 'a.py',
    new_path: 'a.py',
  })).toEqual({
    side: 'new',
    startLine: 218,
    endLine: 247,
    anchorLine: 218,
    label: 'Lines +218–+247',
  })
})

test('falls back when endpoint types are incompatible with the chosen side', () => {
  const mixedSide: Discussion = {
    id: 'mixed-side',
    notes: [{
      id: 1,
      body: 'Mixed endpoint sides',
      position: {
        old_path: 'a.py',
        new_path: 'a.py',
        old_line: null,
        new_line: 247,
        line_range: {
          start: {
            line_code: 'hash_0_218',
            type: 'new',
            old_line: null,
            new_line: 218,
          },
          end: {
            line_code: 'hash_0_247',
            type: 'old',
            old_line: null,
            new_line: 247,
          },
        },
      },
    }],
  }

  expect(discussionRange(mixedSide, {
    old_path: 'a.py',
    new_path: 'a.py',
  })).toEqual({
    side: 'new',
    startLine: 247,
    endLine: 247,
    anchorLine: 247,
    label: 'Lines +247–+247',
  })
})

test('rejects discussions that belong to another file', () => {
  expect(discussionRange(rangedDiscussion, {
    old_path: 'b.py',
    new_path: 'b.py',
  })).toBeNull()
})

test('falls back to the top-level line when the range is malformed', () => {
  const malformed: Discussion = {
    id: 'malformed',
    notes: [{
      id: 1,
      body: 'Single anchor',
      position: {
        old_path: 'a.py',
        new_path: 'a.py',
        old_line: null,
        new_line: 247,
        line_range: {
          start: {
            line_code: 'hash_0_218',
            type: 'new',
            old_line: null,
            new_line: null,
          },
          end: {
            line_code: 'hash_0_247',
            type: 'new',
            old_line: null,
            new_line: 247,
          },
        },
      },
    }],
  }

  expect(discussionRange(malformed, {
    old_path: 'a.py',
    new_path: 'a.py',
  })).toEqual({
    side: 'new',
    startLine: 247,
    endLine: 247,
    anchorLine: 247,
    label: 'Lines +247–+247',
  })
})

test.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'falls back to the valid top-level line for invalid endpoint coordinate %s',
  (invalidLine) => {
    const invalidEndpoint: Discussion = {
      ...rangedDiscussion,
      notes: [{
        ...rangedDiscussion.notes[0],
        position: {
          ...rangedDiscussion.notes[0].position!,
          line_range: {
            ...rangedDiscussion.notes[0].position!.line_range!,
            start: {
              ...rangedDiscussion.notes[0].position!.line_range!.start,
              new_line: invalidLine,
            },
          },
        },
      }],
    }

    expect(discussionRange(invalidEndpoint, {
      old_path: 'a.py',
      new_path: 'a.py',
    })).toEqual({
      side: 'new',
      startLine: 247,
      endLine: 247,
      anchorLine: 247,
      label: 'Lines +247–+247',
    })
  },
)

test.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid top-level anchor %s',
  (invalidLine) => {
    const invalidAnchor: Discussion = {
      ...rangedDiscussion,
      notes: [{
        ...rangedDiscussion.notes[0],
        position: {
          ...rangedDiscussion.notes[0].position!,
          new_line: invalidLine,
        },
      }],
    }

    expect(discussionRange(invalidAnchor, {
      old_path: 'a.py',
      new_path: 'a.py',
    })).toBeNull()
  },
)

test('formats old-side range labels', () => {
  const oldSide: Discussion = {
    id: 'old',
    notes: [{
      id: 1,
      body: 'Removed block',
      position: {
        old_path: 'a.py',
        new_path: 'a.py',
        old_line: 50,
        new_line: null,
        line_range: {
          start: {
            line_code: 'hash_40_0',
            type: 'old',
            old_line: 40,
            new_line: null,
          },
          end: {
            line_code: 'hash_50_0',
            type: 'old',
            old_line: 50,
            new_line: null,
          },
        },
      },
    }],
  }

  expect(discussionRange(oldSide, {
    old_path: 'a.py',
    new_path: 'a.py',
  })).toEqual({
    side: 'old',
    startLine: 40,
    endLine: 50,
    anchorLine: 50,
    label: 'Lines -40–-50',
  })
})

beforeEach(() => {
  document.body.innerHTML = `
    <div id="diff">
      <div class="diff-line" data-state="diff">
        <div class="diff-line-num">
          <span data-line-new-num="12">12</span>
        </div>
      </div>
      <div class="diff-line" data-state="diff">
        <div class="diff-line-num">
          <span data-line-new-num="13">13</span>
        </div>
      </div>
      <div class="diff-line" data-state="diff">
        <div class="diff-line-num">
          <span data-line-new-num="14">14</span>
        </div>
      </div>
    </div>
  `
})

test('highlights contiguous unified diff rows and cleans up', () => {
  const root = document.querySelector<HTMLElement>('#diff')
  if (!root) throw new Error('fixture root is missing')

  const cleanup = highlightDiscussionRanges(root, [
    {
      side: 'new',
      startLine: 12,
      endLine: 14,
      anchorLine: 14,
      label: 'Lines +12–+14',
    },
  ])
  expect(root.querySelectorAll('.mrpr-discussion-range')).toHaveLength(3)
  cleanup()
  expect(root.querySelectorAll('.mrpr-discussion-range')).toHaveLength(0)
})

test('keeps discussion highlights while drag selection is active', () => {
  const root = document.querySelector<HTMLElement>('#diff')
  if (!root) throw new Error('fixture root is missing')

  root.querySelectorAll('.diff-line').forEach((row, index) => {
    if (index === 1) row.classList.add('mrpr-drag-selected')
  })

  const cleanup = highlightDiscussionRanges(root, [
    {
      side: 'new',
      startLine: 12,
      endLine: 14,
      anchorLine: 14,
      label: 'Lines +12–+14',
    },
  ])

  expect(root.querySelectorAll('.mrpr-discussion-range')).toHaveLength(3)
  expect(root.querySelectorAll('.mrpr-drag-selected')).toHaveLength(1)
  cleanup()
  expect(root.querySelectorAll('.mrpr-discussion-range')).toHaveLength(0)
  expect(root.querySelectorAll('.mrpr-drag-selected')).toHaveLength(1)
})

test('highlights split diff rows on one side', () => {
  document.body.innerHTML = `
    <div id="diff">
      ${[12, 13, 14]
        .map(
          (line) => `
            <div class="diff-line" data-state="diff" data-side="new">
              <div class="diff-line-new-num">
                <span data-line-num="${line}">${line}</span>
              </div>
            </div>
          `,
        )
        .join('')}
    </div>
  `
  const root = document.querySelector<HTMLElement>('#diff')
  if (!root) throw new Error('fixture root is missing')

  const cleanup = highlightDiscussionRanges(root, [
    {
      side: 'new',
      startLine: 12,
      endLine: 14,
      anchorLine: 14,
      label: 'Lines +12–+14',
    },
  ])

  expect(root.querySelectorAll('.mrpr-discussion-range')).toHaveLength(3)
  cleanup()
  expect(root.querySelectorAll('.mrpr-discussion-range')).toHaveLength(0)
})
