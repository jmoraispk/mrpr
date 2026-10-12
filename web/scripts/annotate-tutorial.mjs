/**
 * Renders the setup tutorial's three images from the raw GitLab screenshots in
 * docs/examples/: cropped to the part that matters, personal details blurred,
 * and the controls to use marked with numbered callouts and arrows.
 *
 *   node scripts/annotate-tutorial.mjs
 *
 * Coordinates are in source-image pixels. The originals stay in the private
 * repository; only these redacted renders are published with the site.
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const examples = `${root}../docs/examples/`
const out = `${root}site/public/tutorial/`

const ACCENT = '#C2410C'

/** Each step: source, crop, blurred boxes, marked controls, crossed boxes. */
const STEPS = [
  {
    file: '4-applications-list-registered.webp',
    crop: { x: 1250, y: 440, w: 730, h: 210 },
    blur: [{ x: 430, y: 604, w: 1535, h: 76 }],
    marks: [
      {
        box: { x: 1708, y: 478, w: 236, h: 44 },
        n: 1,
        label: 'click',
        labelSide: 'left',
        circle: { x: 1500, y: 500 },
      },
    ],
    cross: [],
  },
  {
    file: '2-new-application-form-full.webp',
    crop: { x: 250, y: 300, w: 830, h: 390 },
    blur: [],
    marks: [
      { box: { x: 271, y: 359, w: 594, h: 36 }, n: 1, label: 'Mr. PR', circle: { x: 920, y: 377 } },
      { box: { x: 271, y: 430, w: 594, h: 51 }, n: 2, label: 'Redirect URI', circle: { x: 920, y: 456 } },
      { box: { x: 268, y: 509, w: 108, h: 26 }, n: 3, label: 'untick', circle: { x: 920, y: 522 } },
      { box: { x: 268, y: 622, w: 52, h: 26 }, n: 4, label: 'api only', circle: { x: 920, y: 635 } },
    ],
    cross: [],
  },
  {
    file: '3-application-created-id.webp',
    crop: { x: 410, y: 470, w: 900, h: 200 },
    blur: [{ x: 683, y: 509, w: 320, h: 46 }],
    marks: [
      {
        box: { x: 1003, y: 505, w: 50, h: 54 },
        n: 1,
        label: 'copy',
        circle: { x: 1150, y: 532 },
      },
    ],
    cross: [{ x: 678, y: 586, w: 620, h: 52 }],
  },
]

function overlays(step) {
  const { crop } = step
  const at = (x, y) => [x - crop.x, y - crop.y]
  const parts = []
  for (const b of step.blur) {
    const [x, y] = at(b.x, b.y)
    parts.push(
      `<div style="position:absolute;left:${x}px;top:${y}px;width:${b.w}px;height:${b.h}px;` +
        'backdrop-filter:blur(9px);background:rgba(120,120,120,.25);border-radius:6px"></div>',
    )
  }
  let svg = ''
  for (const c of step.cross) {
    const [x, y] = at(c.x, c.y)
    parts.push(
      `<div style="position:absolute;left:${x}px;top:${y}px;width:${c.w}px;height:${c.h}px;` +
        'background:rgba(185,28,28,.18);border:3px solid #DC2626;border-radius:8px"></div>',
    )
    svg +=
      `<line x1="${x + 8}" y1="${y + 8}" x2="${x + c.w - 8}" y2="${y + c.h - 8}" stroke="#DC2626" stroke-width="5" stroke-linecap="round"/>` +
      `<line x1="${x + 8}" y1="${y + c.h - 8}" x2="${x + c.w - 8}" y2="${y + 8}" stroke="#DC2626" stroke-width="5" stroke-linecap="round"/>`
    parts.push(
      `<div style="position:absolute;left:${x + c.w - 150}px;top:${y - 22}px;` +
        'padding:4px 12px;border-radius:99px;background:#DC2626;color:#fff;font:700 20px system-ui">not this</div>',
    )
  }
  for (const m of step.marks) {
    const [bx, by] = at(m.box.x, m.box.y)
    const [cx, cy] = at(m.circle.x, m.circle.y)
    parts.push(
      `<div style="position:absolute;left:${bx - 4}px;top:${by - 4}px;width:${m.box.w}px;height:${m.box.h}px;` +
        `border:4px solid ${ACCENT};border-radius:9px;box-shadow:0 0 0 4px rgba(194,65,12,.18)"></div>`,
    )
    // Arrow from the circle to the nearest point on the box edge.
    const tx = Math.max(bx, Math.min(cx, bx + m.box.w))
    const ty = Math.max(by, Math.min(cy, by + m.box.h))
    const dx = tx - cx
    const dy = ty - cy
    const length = Math.hypot(dx, dy) || 1
    const sx = cx + (dx / length) * 22
    const sy = cy + (dy / length) * 22
    const ex = tx - (dx / length) * 6
    const ey = ty - (dy / length) * 6
    svg += `<line x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${ACCENT}" stroke-width="4" marker-end="url(#head)"/>`
    parts.push(
      `<div style="position:absolute;left:${cx - 20}px;top:${cy - 20}px;width:40px;height:40px;border-radius:20px;` +
        `background:${ACCENT};color:#fff;font:800 22px system-ui;display:flex;align-items:center;justify-content:center;` +
        'box-shadow:0 2px 6px rgba(0,0,0,.35)">' +
        `${m.n}</div>`,
    )
    if (m.label) {
      parts.push(
        (m.labelSide === 'left' ? `<div style="position:absolute;right:${crop.w - (cx - 26)}px;top:${cy - 15}px;padding:3px 10px;border-radius:99px;` : `<div style="position:absolute;left:${cx + 26}px;top:${cy - 15}px;padding:3px 10px;border-radius:99px;`) +
          `background:#12161F;color:#F4F4F0;font:600 18px system-ui;white-space:nowrap">${m.label}</div>`,
      )
    }
  }
  return (
    parts.join('') +
    `<svg width="${crop.w}" height="${crop.h}" style="position:absolute;left:0;top:0;overflow:visible">` +
    `<defs><marker id="head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${ACCENT}"/></marker></defs>${svg}</svg>`
  )
}

async function main() {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 2100, height: 2100 } })
  for (const [index, step] of STEPS.entries()) {
    const image = fs.readFileSync(examples + step.file).toString('base64')
    const { crop } = step
    await page.setContent(
      `<body style="margin:0;background:#fff">
        <div id="frame" style="position:relative;width:${crop.w}px;height:${crop.h}px;overflow:hidden">
          <img id="shot" src="data:image/webp;base64,${image}"
               style="position:absolute;left:${-crop.x}px;top:${-crop.y}px">
          ${overlays(step)}
        </div>
      </body>`,
    )
    await page.waitForFunction(() => document.getElementById('shot')?.complete)
    const file = `${out}step-${index + 1}.png`
    await page.locator('#frame').screenshot({ path: file })
    console.log('wrote', file, `${Math.round(fs.statSync(file).size / 1024)} KB`)
  }
  await browser.close()
}

await main()
