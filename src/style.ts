/**
 * Terminal styling for the human-readable reports: colors, underline and the
 * symbol set, with no dependency.
 *
 * Detection follows three switches:
 * - color: off when stdout is not a TTY, when NO_COLOR is set, or TERM=dumb.
 * - truecolor: 24-bit codes only when COLORTERM says so, else 16-color codes.
 * - unicode: symbols like ✖ and █ only when color is on and the locale is not
 *   clearly a non UTF-8 one. Otherwise plain ASCII stand-ins are used.
 */

export interface StyleOptions {
  color: boolean;
  truecolor: boolean;
  unicode: boolean;
}

/** A named color: its truecolor value and its closest 16-color SGR code. */
interface Swatch {
  rgb: [number, number, number];
  ansi16: number;
}

/**
 * The 16-color fallbacks are picked by hand rather than by nearest RGB
 * distance: plain distance maps the infrastructure orange to bright red,
 * which would read as an error.
 */
const SWATCHES = {
  presentation: { rgb: [0x79, 0xc0, 0xff], ansi16: 94 },
  application: { rgb: [0xd2, 0xa8, 0xff], ansi16: 95 },
  domain: { rgb: [0x7e, 0xe7, 0x87], ansi16: 92 },
  infrastructure: { rgb: [0xff, 0xa6, 0x57], ansi16: 33 },
  composition: { rgb: [0x8b, 0x94, 0x9e], ansi16: 90 },
  error: { rgb: [0xff, 0x7b, 0x72], ansi16: 91 },
  warn: { rgb: [0xe3, 0xb3, 0x41], ansi16: 93 },
  dim: { rgb: [0x8b, 0x94, 0x9e], ansi16: 90 },
  ok: { rgb: [0x7e, 0xe7, 0x87], ansi16: 92 },
} satisfies Record<string, Swatch>;

export type ColorName = keyof typeof SWATCHES;

/** Cyan for layers outside the built-in five. */
const UNKNOWN_LAYER_CODE = 36;

export interface Symbols {
  error: string;
  warn: string;
  ok: string;
  arrow: string;
  barFull: string;
  barEmpty: string;
  rule: string;
}

const UNICODE_SYMBOLS: Symbols = {
  error: '✖',
  warn: '⚠',
  ok: '✔',
  arrow: '→',
  barFull: '█',
  barEmpty: '░',
  rule: '─',
};

const PLAIN_SYMBOLS: Symbols = {
  error: 'x',
  warn: '!',
  ok: 'ok',
  arrow: '->',
  barFull: '#',
  barEmpty: '.',
  rule: '-',
};

export type Paint = (text: string) => string;

export interface Style {
  options: StyleOptions;
  symbols: Symbols;
  color(name: ColorName): Paint;
  bold: Paint;
  underline: Paint;
  /** Paint text in a layer's color; unknown layers are cyan. */
  layer(name: string, text?: string): string;
}

/** True unless the locale variables clearly name a non UTF-8 encoding. */
export function isUtf8Locale(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  // Windows terminals do not report a locale this way; modern ones render
  // these symbols fine, so only POSIX locales are inspected.
  if (platform === 'win32') return true;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (!locale) return true;
  return /utf-?8/i.test(locale);
}

export function detectStyle(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
  platform: NodeJS.Platform = process.platform,
): StyleOptions {
  const color = env.NO_COLOR === undefined && env.TERM !== 'dumb' && isTTY;
  const colorterm = (env.COLORTERM ?? '').toLowerCase();
  return {
    color,
    truecolor: color && (colorterm === 'truecolor' || colorterm === '24bit'),
    unicode: color && isUtf8Locale(env, platform),
  };
}

function sgr(open: string, close: string, enabled: boolean): Paint {
  return (text: string) => (enabled && text ? `\u001B[${open}m${text}\u001B[${close}m` : text);
}

export function createStyle(options: StyleOptions): Style {
  const foreground = (swatch: Swatch): Paint => {
    const open = options.truecolor ? `38;2;${swatch.rgb.join(';')}` : String(swatch.ansi16);
    return sgr(open, '39', options.color);
  };

  const painters = Object.fromEntries(
    Object.entries(SWATCHES).map(([name, swatch]) => [name, foreground(swatch)]),
  ) as Record<ColorName, Paint>;
  const unknownLayer = sgr(String(UNKNOWN_LAYER_CODE), '39', options.color);
  const layerNames = new Set(['presentation', 'application', 'domain', 'infrastructure', 'composition']);

  return {
    options,
    symbols: options.unicode ? UNICODE_SYMBOLS : PLAIN_SYMBOLS,
    color: (name) => painters[name],
    bold: sgr('1', '22', options.color),
    underline: sgr('4', '24', options.color),
    layer(name, text = name) {
      return layerNames.has(name) ? painters[name as ColorName](text) : unknownLayer(text);
    },
  };
}

let detected: Style | null = null;

/** The style for the current process's stdout, detected once. */
export function defaultStyle(): Style {
  detected ??= createStyle(detectStyle());
  return detected;
}

/** Styling with everything switched off, for tests and plain logs. */
export const PLAIN_STYLE: Style = createStyle({ color: false, truecolor: false, unicode: false });
