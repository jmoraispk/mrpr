import { beforeEach, expect, test } from 'vitest'

import {
  clearContextPreview,
  clearDragHighlight,
  dragStartFromElement,
  dragTargetFromElement,
  findCommentButton,
  highlightContextPreview,
  highlightDragRange,
} from './dragSelection'

beforeEach(() => {
  document.body.innerHTML = `
    <div id="diff">
      <div class="diff-line" data-state="diff">
        <div class="diff-line-num">
          <span data-line-old-num="10">10</span>
          <span data-line-new-num="12">12</span>
          <div data-add-widget="new"><button type="button">+</button></div>
        </div>
      </div>
      <div class="diff-line" data-state="diff">
        <div class="diff-line-num">
          <span data-line-new-num="13">13</span>
          <div data-add-widget="new"><button type="button">+</button></div>
        </div>
        <div class="diff-line-content"><span>const thirteen = 13;</span></div>
      </div>
      <div class="diff-line" data-state="diff">
        <div class="diff-line-num">
          <span data-line-new-num="14">14</span>
          <div data-add-widget="new"><button type="button">+</button></div>
        </div>
        <div class="diff-line-content"><span>const fourteen = 14;</span></div>
      </div>
    </div>
  `
})

test('reads a selectable side and line from the number gutter', () => {
  const marker = document.querySelector('[data-line-new-num="12"]')

  expect(dragTargetFromElement(marker)).toEqual({
    lineNumber: 12,
    side: 'new',
  })
})

test('reads a line from the code cell so drags can start over code', () => {
  const code = document.querySelector('[data-line-new-num="13"]')
    ?.closest('.diff-line')
    ?.querySelector('.diff-line-content')

  expect(dragTargetFromElement(code ?? null)).toEqual({
    lineNumber: 13,
    side: 'new',
  })
  expect(dragStartFromElement(code ?? null)).toEqual({
    target: { lineNumber: 13, side: 'new' },
    origin: 'code',
  })
})

test('marks a gutter drag apart from one started over code', () => {
  const gutter = document.querySelector('[data-line-new-num="14"]')

  expect(dragStartFromElement(gutter)).toEqual({
    target: { lineNumber: 14, side: 'new' },
    origin: 'gutter',
  })
})

test('previews the context lines GitLab shows above a comment', () => {
  const root = document.querySelector<HTMLElement>('#diff')
  if (!root) throw new Error('diff root is missing')

  highlightContextPreview(root, { lineNumber: 14, side: 'new' }, 2)

  const previewed = [...root.querySelectorAll('.mrpr-context-preview')].map(
    (row) => row.querySelector('[data-line-new-num]')?.textContent,
  )
  expect(previewed).toEqual(['13', '14'])

  clearContextPreview(root)
  expect(root.querySelectorAll('.mrpr-context-preview')).toHaveLength(0)
})

test('clamps the context preview at the first line of the file', () => {
  const root = document.querySelector<HTMLElement>('#diff')
  if (!root) throw new Error('diff root is missing')

  highlightContextPreview(root, { lineNumber: 13, side: 'new' }, 16)

  // Lines 12 and 13 exist above the anchor; the window clamps rather than
  // reaching past the top of the file.
  expect(root.querySelectorAll('.mrpr-context-preview')).toHaveLength(2)
})

test('starts a drag from a comment button without allowing other controls', () => {
  const button = document.querySelector<HTMLButtonElement>(
    '.diff-line-num button',
  )
  if (!button) throw new Error('comment button is missing')
  button.setAttribute('aria-label', 'Comment on new line 12')

  expect(dragStartFromElement(button)).toEqual({
    target: { lineNumber: 12, side: 'new' },
    origin: 'comment-button',
  })

  for (const element of [
    document.createElement('a'),
    document.createElement('input'),
    document.createElement('textarea'),
    document.createElement('select'),
  ]) {
    document.body.append(element)
    expect(dragStartFromElement(element)).toBeNull()
  }
})

test('highlights reverse ranges and locates the endpoint comment button', () => {
  const root = document.querySelector<HTMLElement>('#diff')
  if (!root) throw new Error('fixture root is missing')

  highlightDragRange(
    root,
    { lineNumber: 14, side: 'new' },
    { lineNumber: 12, side: 'new' },
  )

  expect(root.querySelectorAll('.mrpr-drag-selected')).toHaveLength(3)
  expect(
    findCommentButton(root, { lineNumber: 14, side: 'new' }),
  ).toBe(root.querySelector('[data-line-new-num="14"]')?.parentElement
    ?.querySelector('button'))

  clearDragHighlight(root)
  expect(root.querySelectorAll('.mrpr-drag-selected')).toHaveLength(0)
})

test('selects line-number ranges on one side of a split diff', () => {
  document.body.innerHTML = `
    <div id="diff">
      ${[1, 2, 3]
        .map(
          (line) => `
            <div class="diff-line" data-state="diff" data-side="old">
              <div class="diff-line-old-num">
                <span data-line-num="${line}">${line}</span>
                <div data-add-widget="old"><button type="button">+</button></div>
              </div>
            </div>
          `,
        )
        .join('')}
      <div class="diff-line" data-state="diff" data-side="new">
        <div class="diff-line-new-num">
          <span data-line-num="1">1</span>
        </div>
      </div>
    </div>
  `
  const root = document.querySelector<HTMLElement>('#diff')
  const marker = document.querySelector('[data-side="old"] [data-line-num="3"]')
  if (!root) throw new Error('fixture root is missing')

  expect(dragTargetFromElement(marker)).toEqual({
    lineNumber: 3,
    side: 'old',
  })
  expect(dragTargetFromElement(marker?.parentElement ?? null)).toEqual({
    lineNumber: 3,
    side: 'old',
  })
  expect(
    dragTargetFromElement(root.querySelector('button')),
  ).toBeNull()
  highlightDragRange(
    root,
    { lineNumber: 3, side: 'old' },
    { lineNumber: 1, side: 'old' },
  )

  expect(root.querySelectorAll('.mrpr-drag-selected')).toHaveLength(3)
  expect(
    findCommentButton(root, { lineNumber: 3, side: 'old' }),
  ).not.toBeNull()
})
