// Renders the real colored `4layers check --stats` output of the cli-visuals
// fixture to docs/cli-output.svg, for the README. GitHub cannot show ANSI
// colors in a code block, so the README embeds this image instead.
//
// Usage: npm run build && npm run docs:screenshot

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, createStyle, formatLayerTable, formatPretty } from '../dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const style = createStyle({ color: true, truecolor: true, unicode: true });

const result = await check({ root: path.join(root, 'test/fixtures/cli-visuals') });
result.stats.durationMs = 24; // a stable, realistic number for the picture

const dim = style.color('dim');
const transcript = [
  `${dim('$')} npx 4layers check --stats`,
  `${style.bold('4layers')} ${dim(`${pkg.version} · classic preset`)}`,
  '',
  formatLayerTable(result, style),
  '',
  formatPretty(result, style),
].join('\n');

// Same palette as GitHub's dark terminal theme, which the CLI colors follow.
const BACKGROUND = '#0d1117';
const FOREGROUND = '#e6edf3';
const ANSI16 = { 36: '#39c5cf' };
const FONT_SIZE = 13;
const CHAR_WIDTH = 7.85;
const LINE_HEIGHT = 19;
const PAD_X = 20;
const PAD_TOP = 44;
const PAD_BOTTOM = 18;

/** Split one line with SGR codes into styled runs. */
function parseLine(line) {
  const runs = [];
  let state = { color: null, bold: false, underline: false };
  const re = /\u001B\[([0-9;]*)m/g;
  let last = 0;
  let match;
  const push = (text) => {
    if (text) runs.push({ text, ...state });
  };
  while ((match = re.exec(line)) !== null) {
    push(line.slice(last, match.index));
    last = re.lastIndex;
    const codes = match[1].split(';').map(Number);
    state = { ...state };
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 38 && codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5);
        state.color = `rgb(${r},${g},${b})`;
        i += 4;
      } else if (code === 39) state.color = null;
      else if (code === 1) state.bold = true;
      else if (code === 22) state.bold = false;
      else if (code === 4) state.underline = true;
      else if (code === 24) state.underline = false;
      else if (ANSI16[code]) state.color = ANSI16[code];
    }
  }
  push(line.slice(last));
  return runs;
}

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const lines = transcript.split('\n');
const bars = [];
const plain = lines.map((line) => line.replace(/\u001B\[[0-9;]*m/g, ''));
const columns = Math.max(...plain.map((line) => [...line].length));
const width = Math.ceil(PAD_X * 2 + columns * CHAR_WIDTH);
const height = PAD_TOP + lines.length * LINE_HEIGHT + PAD_BOTTOM;

const body = lines
  .map((line, index) => {
    const y = PAD_TOP + (index + 1) * LINE_HEIGHT - 5;
    let column = 0;
    const spans = parseLine(line)
      .map((run) => {
        const length = [...run.text].length;
        const x = (PAD_X + column * CHAR_WIDTH).toFixed(2);
        column += length;
        if (!run.text.trim()) return '';
        // Bar cells are drawn as rectangles: block glyphs leave hairline gaps
        // between cells in most fonts.
        if (/^[█░]+$/.test(run.text)) {
          bars.push({
            x: Number(x),
            y: y - FONT_SIZE + 2,
            width: length * CHAR_WIDTH,
            color: run.color ?? FOREGROUND,
            empty: run.text[0] === '░',
          });
          return '';
        }
        // Pin every run to the character grid: glyphs such as █ and ─ often
        // come from a fallback font with another width, which would otherwise
        // push the bars and columns out of line.
        const attributes = [
          `x="${x}"`,
          `textLength="${(length * CHAR_WIDTH).toFixed(2)}"`,
          'lengthAdjust="spacingAndGlyphs"',
          run.color ? `fill="${run.color}"` : '',
          run.bold ? 'font-weight="700"' : '',
          run.underline ? 'text-decoration="underline"' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<tspan ${attributes}>${escape(run.text)}</tspan>`;
      })
      .join('');
    return `  <text y="${y}" xml:space="preserve">${spans}</text>`;
  })
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="4layers check --stats output">
  <title>4layers check --stats output</title>
  <rect width="${width}" height="${height}" rx="10" fill="${BACKGROUND}"/>
  <circle cx="22" cy="20" r="6" fill="#ff5f57"/>
  <circle cx="42" cy="20" r="6" fill="#febc2e"/>
  <circle cx="62" cy="20" r="6" fill="#28c840"/>
${bars
  .map(
    (bar) =>
      `  <rect x="${bar.x.toFixed(2)}" y="${bar.y}" width="${bar.width.toFixed(2)}" height="${FONT_SIZE - 1}" rx="1.5" fill="${bar.color}"${bar.empty ? ' fill-opacity="0.22"' : ''}/>`,
  )
  .join('\n')}
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT_SIZE}" fill="${FOREGROUND}">
${body}
  </g>
</svg>
`;

const out = path.join(root, 'docs', 'cli-output.svg');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(root, out)} (${width}x${height})`);
