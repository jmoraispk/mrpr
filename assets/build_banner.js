const fs = require("fs");
const path = require("path");

const TAGLINE = "GitLab MR reviews, minus the wait.";

function dotGrid() {
  const sp = 46, r = 1.9, out = [];
  for (let y = 24; y < 320; y += sp) {
    for (let x = 24; x < 1280; x += sp) {
      const teal = ((Math.round(x / sp) + Math.round(y / sp)) % 2) === 0;
      const col = teal ? "#2DD4BF" : "#3FB950";
      const d = (((x / sp) * 0.13 + (y / sp) * 0.19) % 3.2).toFixed(2);
      out.push(`<circle class="dot" cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="0.12" style="animation-delay:-${d}s"/>`);
    }
  }
  return `  <g aria-hidden="true">\n    ${out.join("\n    ")}\n  </g>\n`;
}

function svg({ withDots }) {
  const dotCss = withDots
    ? `
      @keyframes twinkle { 0%,100% { opacity: .05; } 50% { opacity: .22; } }
      .dot { animation: twinkle 3.2s ease-in-out infinite; }`
    : "";
  const dotReduced = withDots ? " .dot { animation: none; opacity: .12; }" : "";
  const grid = withDots ? dotGrid() : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 320" width="1280" height="320" font-family="'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif" role="img" aria-label="Mr. PR — ${TAGLINE}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2DD4BF"/>
      <stop offset="100%" stop-color="#3FB950"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#132029"/>
      <stop offset="100%" stop-color="#0D1117"/>
    </radialGradient>
    <clipPath id="round"><rect x="0" y="0" width="1280" height="320" rx="16"/></clipPath>
    <clipPath id="card"><rect x="712" y="48" width="504" height="224" rx="12"/></clipPath>
    <style>
      .mono { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; }
      @keyframes review-scan {
        0%      { opacity: .09; transform: translateY(0); }
        31%     { opacity: .09; transform: translateY(132px); }
        62%     { opacity: .09; transform: translateY(0); }
        64%,100% { opacity: 0; transform: translateY(0); }
      }
      @keyframes review-caret {
        0%, 66%, 70%, 76%, 82%, 88%, 94%, 100% { opacity: 0; }
        67%, 73%, 79%, 85%, 91%                { opacity: 1; }
      }
      @keyframes review-comment {
        0%, 64%   { opacity: 0; transform: translateY(6px) scale(.96); }
        67%, 94% { opacity: 1; transform: translateY(0) scale(1); }
        100%      { opacity: 0; transform: translateY(4px) scale(.98); }
      }
      @keyframes pulse { 50% { transform: scale(1.05); } }
      .scan   { animation: review-scan 11s ease-in-out infinite; }
      .caret  { animation: review-caret 11s steps(1) infinite; }
      .mark   { animation: pulse 3s ease-in-out infinite; transform-origin: 96px 126px; }
      .bubble { animation: review-comment 11s ease-in-out infinite; transform-origin: 900px 218px; }${dotCss}
      @media (prefers-reduced-motion: reduce) {
        .scan, .caret, .mark, .bubble { animation: none; }
        .scan, .caret { opacity: 0; }
        .bubble { opacity: 1; transform: none; }${dotReduced}
      }
    </style>
  </defs>

  <g clip-path="url(#round)">
  <!-- background -->
  <rect width="1280" height="320" fill="#0D1117"/>
  <rect width="1280" height="320" fill="url(#glow)"/>
${grid}
  <!-- ===== left: wordmark ===== -->
  <g class="mark">
    <polygon points="96,92 128,156 64,156" fill="url(#brand)"/>
    <polygon points="96,110 116,150 76,150" fill="#0D1117" opacity="0.35"/>
  </g>
  <text x="150" y="151" font-size="74" font-weight="700" fill="#E6EDF3" letter-spacing="-1">Mr. PR</text>
  <text x="66" y="197" font-size="22" fill="#8B949E">${TAGLINE}</text>

  <!-- pill -->
  <rect x="66" y="222" width="337" height="40" rx="20" fill="#161B22" stroke="#30363D"/>
  <circle cx="88" cy="242" r="5" fill="#3FB950"/>
  <text x="104" y="247" class="mono" font-size="15" fill="#9DA7B3">reads your glab token &#8212; no login</text>

  <!-- ===== right: animated diff card ===== -->
  <rect x="712" y="48" width="504" height="224" rx="12" fill="#161B22" stroke="#30363D"/>
  <circle cx="736" cy="70" r="5" fill="#F85149"/>
  <circle cx="754" cy="70" r="5" fill="#D29922"/>
  <circle cx="772" cy="70" r="5" fill="#3FB950"/>
  <text x="792" y="75" class="mono" font-size="14" fill="#6E7681">orderService.ts</text>
  <line x1="712" y1="88" x2="1216" y2="88" stroke="#30363D"/>

  <g clip-path="url(#card)">
    <rect class="scan" x="716" y="100" width="496" height="26" fill="#2DD4BF" opacity="0.09"/>
    <rect x="716" y="131" width="496" height="24" fill="#F85149" opacity="0.10"/>
    <rect x="716" y="158" width="496" height="24" fill="#3FB950" opacity="0.12"/>
    <rect x="716" y="185" width="496" height="24" fill="#3FB950" opacity="0.12"/>
    <g class="mono" font-size="14" fill="#484F58" text-anchor="end">
      <text x="752" y="122">41</text>
      <text x="752" y="149">42</text>
      <text x="752" y="176">43</text>
      <text x="752" y="203">44</text>
      <text x="752" y="230">45</text>
      <text x="752" y="257">46</text>
    </g>
    <g class="mono" font-size="14">
      <text x="760" y="149" fill="#F85149">-</text>
      <text x="760" y="176" fill="#3FB950">+</text>
      <text x="760" y="203" fill="#3FB950">+</text>
    </g>
    <g class="mono" font-size="14" fill="#C9D1D9">
      <text x="776" y="122"><tspan fill="#FF7B72">const</tspan> items = <tspan fill="#FF7B72">await</tspan> <tspan fill="#D2A8FF">fetch</tspan>(url)</text>
      <text x="776" y="149"><tspan fill="#FF7B72">return</tspan> res.data.items</text>
      <text x="776" y="176"><tspan fill="#FF7B72">const</tspan> { items } = <tspan fill="#FF7B72">await</tspan> res.<tspan fill="#D2A8FF">json</tspan>()</text>
      <text x="776" y="203"><tspan fill="#FF7B72">return</tspan> items ?? []</text>
      <text x="776" y="230">}</text>
      <text x="776" y="257"><tspan fill="#FF7B72">export default</tspan> handler</text>
    </g>
    <rect class="caret" x="900" y="190" width="2" height="17" fill="#2DD4BF"/>
  </g>

  <!-- inline comment bubble -->
  <g class="bubble">
    <polygon points="892,218 908,218 900,204" fill="#1C2431"/>
    <rect x="842" y="218" width="270" height="50" rx="10" fill="#1C2431" stroke="#2DD4BF" stroke-opacity="0.55"/>
    <circle cx="864" cy="237" r="8" fill="url(#brand)"/>
    <text x="880" y="242" font-size="13" font-weight="700" fill="#E6EDF3">you<tspan fill="#6E7681" font-weight="400">  &#183;  now</tspan></text>
    <text x="854" y="261" class="mono" font-size="13" fill="#9DA7B3">type the return as string[]?</text>
  </g>
  </g>
</svg>
`;
}

module.exports = { svg };

if (require.main === module) {
  const outputPath = path.join(__dirname, "banner.svg");
  fs.writeFileSync(outputPath, svg({ withDots: true }));
  console.log(`wrote ${outputPath}`);
}
