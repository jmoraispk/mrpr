// The browser-extension mark: a solid inverted triangle -- the nabla carried
// over from the project's first name -- in a deepened version of the project
// green.
//
// Run `node assets/build_icon.js` to regenerate assets/icon.svg and the PNGs in
// assets/icons/, which web/scripts/build-extension.mjs copies into both
// extension targets. They deliberately do NOT live in web/public/: that
// directory is shared with the SPA build, which writes into the packaged Python
// static dir, and the CLI has no use for browser-extension artwork.
//
// The rasteriser is written out longhand so the PNGs stay reproducible without
// pulling a native image dependency into a repo that otherwise only needs Node
// to build the extension.
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

// Geometry lives on a 128-unit square, so every shipped size is a clean scale.
// The triangle spans 96 units wide and 80 tall: 16 units of margin down each
// side and along the bottom, 32 across the top. The extra headroom drops the
// shape below the geometric centre, which is what stops a top-heavy wedge from
// looking like it is floating. Every coordinate is a multiple of 16, so at 16,
// 32, 48 and 128 pixels each vertex lands on a whole pixel and the flat top
// edge stays crisp instead of smearing across two rows.
const CANVAS = 128
// NOT `--mrpr` (#40d6b2) from web/src/index.css, and please do not "fix" it
// back. That value is tuned to sit on `--canvas` (#0d1117) and it manages only
// 1.83:1 against white -- but Chrome and Edge ship a light toolbar by default,
// so a mark has to survive both. This is the same hue (165.4deg vs 165.6deg,
// derived by scaling #40d6b2 in linear light, which preserves chromaticity)
// darkened until it clears 3:1 on either extreme: 4.03:1 against #ffffff and
// 4.00:1 against a #202124 dark toolbar. The UI palette is right for the UI;
// this is a different surface with a different constraint.
const FILL = '#278e75'
const POINTS = [
  [16, 32],
  [112, 32],
  [64, 112],
]
const SIZES = [16, 32, 48, 128]
// Coverage samples per pixel axis, i.e. 64 samples per pixel.
const SAMPLES = 8

function svg() {
  const [[ax, ay], [bx], [cx, cy]] = POINTS

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}" role="img" aria-label="Mr. PR">
  <path d="M${ax} ${ay}H${bx}L${cx} ${cy}Z" fill="${FILL}"/>
</svg>
`
}

function channels(hex) {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16))
}

function inside(x, y) {
  const [[ax, ay], [bx, by], [cx, cy]] = POINTS
  const edges = [
    (x - bx) * (ay - by) - (ax - bx) * (y - by),
    (x - cx) * (by - cy) - (bx - cx) * (y - cy),
    (x - ax) * (cy - ay) - (cx - ax) * (y - ay),
  ]

  return !(edges.some((d) => d < 0) && edges.some((d) => d > 0))
}

// Flat RGBA rows: the fill is constant and only the alpha carries the shape, so
// edge pixels come out as the fill at partial coverage rather than a blend
// against whatever the browser chrome happens to be.
function pixels(size) {
  const scale = CANVAS / size
  const [red, green, blue] = channels(FILL)
  const data = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) * scale
          const y = (py + (sy + 0.5) / SAMPLES) * scale
          if (inside(x, y)) hits += 1
        }
      }
      const at = (py * size + px) * 4
      data[at] = red
      data[at + 1] = green
      data[at + 2] = blue
      data[at + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
    }
  }

  return data
}

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(tagged))

  return Buffer.concat([length, tagged, crc])
}

function png(size) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bits per channel
  header[9] = 6 // truecolour with alpha

  // Every scanline takes filter type 0; the shapes are too small for filtering
  // to buy anything, and unfiltered rows keep the encoder easy to audit.
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  const data = pixels(size)
  for (let y = 0; y < size; y += 1) {
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

module.exports = { CANVAS, FILL, POINTS, SIZES, png, svg }

if (require.main === module) {
  const source = path.join(__dirname, 'icon.svg')
  fs.writeFileSync(source, svg())
  console.log(`wrote ${source}`)

  // Exactly the set the extension ships, so the build can copy it wholesale.
  const pngDir = path.join(__dirname, 'icons')
  fs.mkdirSync(pngDir, { recursive: true })
  for (const size of SIZES) {
    const target = path.join(pngDir, `icon-${size}.png`)
    fs.writeFileSync(target, png(size))
    console.log(`wrote ${target}`)
  }
}
