/**
 * Modern Oranges for Zed, with blur.
 *
 * Modern Oranges (https://github.com/nithenz/modern-oranges-theme) is a VS Code
 * theme. This module turns its six VS Code variants into Zed themes:
 *
 *   1. The upstream VS Code theme JSON (JSON with comments) is parsed.
 *   2. Every Zed syntax capture in `SYNTAX_MAP` is resolved against the VS Code
 *      `tokenColors` using TextMate scope-selector semantics, so the token
 *      colors (and italics) are exactly what VS Code would render for the
 *      representative scope. If the upstream theme changes, re-running the
 *      sync picks the change up.
 *   3. UI colors come from the VS Code `colors` map where VS Code defines one,
 *      otherwise from `FAMILY_DEFAULTS` below.
 *   4. The blur overrides get the blur levels from `blur.mjs`.
 *
 * Zed's tree-sitter captures are coarser than TextMate scopes, so a few
 * mappings are judgment calls. They are documented inline in `SYNTAX_MAP`.
 */

import { BLUR_LEVELS, blurVariantName, generateThemeOverridesForLevel } from "./blur.mjs";

export const MODERN_ORANGES_FAMILY_NAME = "Modern Oranges Blur";
export const MODERN_ORANGES_AUTHOR = "nithenz";

/** Where the upstream VS Code theme files are fetched from. */
export const MODERN_ORANGES_SOURCE_BASE =
  "https://raw.githubusercontent.com/nithenz/modern-oranges-theme/master/themes/";

/**
 * The six upstream VS Code variants.
 *
 * `family` selects the UI defaults: "classic" (Modern Oranges / Operator) and
 * "vibrate" (Vibrate, Vibrate Dark, Vibrate Gray, Black). Token colors are
 * always read from the variant's own file.
 */
export const MODERN_ORANGES_VARIANTS = [
  { key: "default", file: "mo.default.json", name: "Modern Oranges", family: "classic" },
  { key: "operator", file: "mo.operator.json", name: "Modern Oranges Operator", family: "classic" },
  { key: "vibrate", file: "mo.vibrate.json", name: "Modern Oranges Vibrate", family: "vibrate" },
  { key: "vibrate_dark", file: "mo.vibrate-dark.json", name: "Modern Oranges Vibrate Dark", family: "vibrate" },
  { key: "vibrate_gray", file: "mo.vibrate-gray-back.json", name: "Modern Oranges Vibrate Gray", family: "vibrate" },
  { key: "black", file: "mo.black.json", name: "Modern Oranges Black", family: "vibrate" },
];

/**
 * Extra Zed style overrides per variant, applied last (after the blur
 * overrides). Keys are Zed style keys. Use this for Zed-specific tweaks that
 * should not be derived from the VS Code theme.
 */
export const VARIANT_STYLE_OVERRIDES = {
  default: {},
  operator: {},
  vibrate: {},
  vibrate_dark: {},
  vibrate_gray: {},
  black: {},
};

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Normalize a CSS hex color to lowercase `#rrggbb` or `#rrggbbaa`. */
export function normalizeColor(value) {
  if (typeof value !== "string") return undefined;
  let hex = value.trim().toLowerCase();
  if (!hex.startsWith("#")) return undefined;
  hex = hex.slice(1);
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return undefined;
  if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6);
  return `#${hex}`;
}

/** Drop the alpha channel: `#rrggbbaa` -> `#rrggbb`. */
export function opaque(color) {
  const c = normalizeColor(color);
  return c ? c.slice(0, 7) : undefined;
}

/** Replace (or add) the alpha channel: `withAlpha("#ff0000", "80")` -> `#ff000080`. */
export function withAlpha(color, alpha) {
  return opaque(color) + alpha;
}

function toRgb(color) {
  const c = opaque(color);
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

function fromRgb([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** Linear mix of two opaque colors: `t = 0` gives `a`, `t = 1` gives `b`. */
export function mix(a, b, t) {
  const ra = toRgb(a);
  const rb = toRgb(b);
  return fromRgb(ra.map((v, i) => v + (rb[i] - v) * t));
}

// ---------------------------------------------------------------------------
// VS Code theme parsing
// ---------------------------------------------------------------------------

/**
 * Parse JSON with `//` and `/* *\/` comments and trailing commas (the upstream
 * VS Code theme files contain both).
 */
export function parseJsonc(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === "\\") j++;
        j++;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out);
}

/**
 * Build a resolver that answers "what would VS Code render for this scope
 * stack?" from a theme's `tokenColors`.
 *
 * `resolve("source.ts meta.var.expr.ts storage.type.ts")` returns
 * `{ foreground, fontStyle }` following TextMate rules: a selector matches when
 * its space-separated segments match elements of the scope stack in order
 * (each segment is a dot-prefix of an element); deeper matches win, then more
 * specific segments, then later rules. `foreground` and `fontStyle` are
 * resolved independently, as in VS Code.
 */
export function createScopeResolver(tokenColors) {
  const rules = [];
  tokenColors.forEach((rule, index) => {
    const raw = rule.scope ?? [];
    const selectors = Array.isArray(raw) ? raw : String(raw).split(",");
    for (const selector of selectors) {
      const trimmed = selector.trim();
      if (!trimmed) continue;
      const segments = trimmed.split(/\s+/).map((seg) => seg.split(".").filter(Boolean));
      if (segments.some((seg) => seg.length === 0)) continue;
      rules.push({ index, segments, settings: rule.settings ?? {} });
    }
  });

  const segmentMatches = (segment, element) =>
    segment.length <= element.length && segment.every((part, k) => part === element[k]);

  function matchSelector(segments, elements) {
    const last = segments[segments.length - 1];
    for (let depth = elements.length - 1; depth >= 0; depth--) {
      if (!segmentMatches(last, elements[depth])) continue;
      let e = depth - 1;
      let ok = true;
      for (let s = segments.length - 2; s >= 0; s--) {
        while (e >= 0 && !segmentMatches(segments[s], elements[e])) e--;
        if (e < 0) {
          ok = false;
          break;
        }
        e--;
      }
      if (ok) return { depth, parts: last.length, count: segments.length };
    }
    return null;
  }

  return function resolve(scopePath) {
    const elements = scopePath.trim().split(/\s+/).map((el) => el.split("."));
    const matches = [];
    for (const rule of rules) {
      const m = matchSelector(rule.segments, elements);
      if (m) matches.push({ ...m, rule });
    }
    matches.sort(
      (a, b) => a.depth - b.depth || a.parts - b.parts || a.count - b.count || a.rule.index - b.rule.index,
    );
    let foreground;
    let fontStyle;
    for (const m of matches) {
      if (m.rule.settings.foreground !== undefined) {
        foreground = normalizeColor(m.rule.settings.foreground) ?? foreground;
      }
      if (m.rule.settings.fontStyle !== undefined) fontStyle = m.rule.settings.fontStyle;
    }
    return { foreground, fontStyle };
  };
}

// ---------------------------------------------------------------------------
// Syntax mapping: Zed capture -> representative VS Code scope stack
// ---------------------------------------------------------------------------

/**
 * Each entry maps a Zed syntax key to one or more VS Code scope stacks. The
 * first stack that resolves to a foreground color wins; its font style is used
 * too. `color` forces a palette color instead, `italic: true/false` forces the
 * font style, `weight` forces the font weight.
 *
 * Scope stacks are written the way the TextMate grammars emit them, so the
 * resolver sees the same thing VS Code does.
 */
const T = (key, scopes, extra = {}) => ({ key, scopes: [].concat(scopes ?? []), ...extra });

const TS_STRING = "source.ts string.quoted.double.ts";
const TS_FUNCTION = "source.ts entity.name.function.ts";
const TS_TYPE = "source.ts entity.name.type.ts";
const TS_PROPERTY = "source.ts variable.other.property.ts";
const TS_CONTROL = "source.ts keyword.control.flow.ts";
const TS_STORAGE_TYPE = "source.ts storage.type.ts";
const TS_COMMENT = "source.ts comment.line.double-slash.ts";
const TS_DOC_COMMENT = "source.ts comment.block.documentation.ts";
const TS_REGEX = "source.ts string.regexp.ts";
const TS_CONSTANT = "source.ts constant.language.ts";
const PY_DOCSTRING = "source.python string.quoted.docstring.multi.python";
const C_PREPROC = "source.c meta.preprocessor.include.c keyword.control.directive.include.c";
const MD = "text.html.markdown";

export const SYNTAX_MAP = [
  // --- Identifiers -------------------------------------------------------
  T("variable", "source.ts variable.other.readwrite.ts"),
  T("variable.builtin", "source.ts variable.language.this.ts"),
  T("variable.special", "source.ts variable.language.this.ts"),
  T("variable.parameter", "source.ts meta.parameters.ts variable.parameter.ts"),
  T("variable.member", TS_PROPERTY),
  // Zed uses one capture for member access, object keys and class fields.
  // VS Code colors all of them with the variable color except object literal
  // keys, so member access (the most common case) wins.
  T("property", TS_PROPERTY),
  T("property.json_key", "source.json support.type.property-name.json"),
  T("field", TS_PROPERTY),
  // Zed captures SCREAMING_CASE identifiers as constants; use the theme's
  // constant color rather than the plain variable color. VS Code renders these
  // identifiers upright, so the italic of `constant.language` is not inherited.
  T("constant", ["source.ts constant.other.ts", TS_CONSTANT], { italic: false }),
  T("constant.builtin", "source.ts constant.language.null.ts"),
  T("constant.macro", "source.c entity.name.function.preprocessor.c"),
  T("module", "source.ts entity.name.namespace.ts"),
  T("namespace", "source.ts entity.name.namespace.ts"),
  T("label", "source.ts entity.name.label.ts"),
  T("lifetime", "source.rust storage.modifier.lifetime.rust"),
  T("attribute", "text.html.basic entity.other.attribute-name.html"),
  T("attribute.jsx", "source.tsx entity.other.attribute-name.tsx"),
  T("attribute.builtin", "source.python entity.name.function.decorator.python"),
  T("attribute.special", "source.python support.variable.magic.python"),

  // --- Literals ----------------------------------------------------------
  T("string", TS_STRING),
  T("string.documentation", PY_DOCSTRING),
  T("string.doc", PY_DOCSTRING),
  T("string.regex", TS_REGEX),
  T("string.regexp", TS_REGEX),
  T("string.escape", `${TS_STRING} constant.character.escape.ts`),
  T("string.special", "source.css constant.other.color.rgb-value.hex.css"),
  T("string.special.symbol", ["source.ruby constant.other.symbol.ruby", TS_CONSTANT], { italic: false }),
  T("string.special.path", TS_STRING),
  T("string.special.url", [`${MD} markup.underline.link.markdown`, TS_STRING], { italic: true }),
  T("symbol", ["source.ruby constant.other.symbol.ruby", TS_CONSTANT], { italic: false }),
  T("character", "source.c constant.character.c"),
  T("character.special", "source.ts constant.character.escape.ts"),
  T("boolean", "source.ts constant.language.boolean.true.ts"),
  T("number", "source.ts constant.numeric.decimal.ts"),
  T("number.float", "source.ts constant.numeric.decimal.ts"),
  T("float", "source.ts constant.numeric.decimal.ts"),

  // --- Tags / markup -----------------------------------------------------
  T("tag", "text.html.basic entity.name.tag.html"),
  T("tag.jsx", "source.tsx entity.name.tag.tsx"),
  T("tag.component", "source.tsx support.class.component.tsx"),
  T("tag.component.jsx", "source.tsx support.class.component.tsx"),
  T("tag.attribute", "text.html.basic entity.other.attribute-name.html"),
  T("tag.delimiter", "text.html.basic punctuation.definition.tag.begin.html"),
  T("tag.doctype", ["text.html.basic meta.tag.sgml.doctype.html", "text.html.basic entity.name.tag.html"]),
  T("text.jsx", [], { color: (p) => p.fg }),
  T("punctuation.bracket.jsx", "source.tsx punctuation.definition.tag.begin.tsx"),
  T("punctuation.bracket.html", "text.html.basic punctuation.definition.tag.begin.html"),
  T("punctuation.delimiter.jsx", "source.tsx keyword.operator.assignment.tsx", { italic: false }),
  T("punctuation.delimiter.html", "text.html.basic punctuation.separator.key-value.html", { italic: false }),

  // --- Types -------------------------------------------------------------
  T("type", TS_TYPE),
  T("type.builtin", "source.ts support.type.primitive.ts"),
  T("type.class", "source.ts entity.name.type.class.ts"),
  T("type.class.definition", "source.ts entity.name.type.class.ts"),
  T("type.class.inheritance", "source.ts entity.other.inherited-class.ts"),
  T("type.class.call", "source.ts entity.name.type.class.ts"),
  T("type.class.builtin", "source.python support.type.exception.python"),
  T("type.definition", TS_TYPE),
  T("type.interface", "source.ts entity.name.type.interface.ts"),
  T("type.super", "source.ts entity.other.inherited-class.ts"),
  T("type.name", TS_TYPE),
  T("type.unit", "source.css keyword.other.unit.css"),
  T("type.jsdoc", `${TS_DOC_COMMENT} entity.name.type.instance.jsdoc`),
  T("enum", "source.ts entity.name.type.enum.ts"),
  T("variant", "source.ts variable.other.enummember.ts"),
  T("constructor", TS_STORAGE_TYPE),

  // --- Functions ---------------------------------------------------------
  T("function", TS_FUNCTION),
  T("function.call", TS_FUNCTION),
  T("function.method", TS_FUNCTION),
  T("function.method.call", TS_FUNCTION),
  T("function.definition", TS_FUNCTION),
  T("function.builtin", TS_FUNCTION),
  T("function.special", TS_FUNCTION),
  T("function.special.definition", TS_FUNCTION),
  T("function.macro", TS_FUNCTION),
  T("function.decorator", "source.python entity.name.function.decorator.python"),
  T("function.decorator.call", "source.python entity.name.function.decorator.python"),
  T("function.kwargs", "source.python variable.parameter.function-call.python"),

  // --- Keywords ----------------------------------------------------------
  // Zed's generic @keyword covers modifiers (async, static, pub, ...) and
  // word operators (new, typeof, in, ...). The theme's own keyword color is
  // used for it; declaration, import and control-flow keywords get their
  // specific VS Code colors through the captures below.
  T("keyword", "source.ts keyword.other.ts"),
  T("keyword.declaration", TS_STORAGE_TYPE),
  T("keyword.definition", "source.python storage.type.function.python"),
  T("keyword.import", "source.ts keyword.control.import.ts"),
  T("keyword.export", "source.ts keyword.control.export.ts"),
  T("keyword.control", TS_CONTROL),
  T("keyword.conditional", "source.ts keyword.control.conditional.ts"),
  T("keyword.conditional.ternary", "source.ts keyword.control.conditional.ts"),
  T("keyword.repeat", "source.ts keyword.control.loop.ts"),
  T("keyword.return", TS_CONTROL),
  T("keyword.exception", "source.ts keyword.control.trycatch.ts"),
  T("keyword.coroutine", TS_CONTROL),
  T("keyword.debug", TS_CONTROL),
  T("keyword.operator", "source.python keyword.operator.logical.python"),
  T("keyword.modifier", "source.ts storage.modifier.ts"),
  T("keyword.type", TS_STORAGE_TYPE),
  T("keyword.function", "source.ts storage.type.function.ts"),
  T("keyword.directive", C_PREPROC),
  T("keyword.directive.define", "source.c meta.preprocessor.macro.c keyword.control.directive.define.c"),
  T("keyword.preproc", C_PREPROC),
  T("preproc", C_PREPROC),
  T("keyword.jsdoc", `${TS_DOC_COMMENT} storage.type.class.jsdoc`),
  T("variable.jsdoc", `${TS_DOC_COMMENT} variable.other.jsdoc`),

  // --- Operators & punctuation ------------------------------------------
  // Operators are kept upright: the VS Code italics rule technically covers
  // `keyword.operator`, which only looks right with a cursive-italic font.
  T("operator", "source.ts keyword.operator.assignment.ts", { italic: false }),
  T("operator.regex", `${TS_REGEX} keyword.control.anchor.regexp`),
  T("punctuation", "source.ts punctuation.terminator.statement.ts"),
  T("punctuation.delimiter", "source.ts punctuation.separator.comma.ts"),
  T("punctuation.bracket", "source.ts meta.brace.round.ts"),
  // Template-literal `${ }` delimiters. Zed also uses this capture for the
  // `:` in type annotations and `|` in union types.
  T("punctuation.special", "source.ts punctuation.definition.template-expression.begin.ts"),
  T("punctuation.special.symbol", ["source.ruby constant.other.symbol.ruby", TS_CONSTANT], { italic: false }),
  T("punctuation.list_marker", `${MD} punctuation.definition.list.begin.markdown`),
  T("punctuation.markup", `${MD} punctuation.definition.quote.begin.markdown`),
  T("punctuation.embedded.markup", `${MD} punctuation.definition.markdown`),
  T("punctuation.bracket.regex", `${TS_REGEX} punctuation.definition.group.regexp`),
  T("punctuation.delimiter.regex", TS_REGEX),
  T("string.escape.regex", `${TS_REGEX} constant.other.character-class.regexp`),
  T("keyword.operator.regex", `${TS_REGEX} keyword.control.anchor.regexp`),
  T("number.quantifier.regex", `${TS_REGEX} keyword.operator.quantifier.regexp`),
  T("label.regex", `${TS_REGEX} variable.other.regexp`),

  // --- Comments ----------------------------------------------------------
  T("comment", TS_COMMENT),
  T("comment.doc", TS_DOC_COMMENT),
  T("comment.documentation", TS_DOC_COMMENT),
  // Comment annotations do not exist in VS Code themes; use palette colors
  // and keep the comment font style.
  T("comment.todo", TS_COMMENT, { color: (p) => p.pink }),
  T("comment.note", TS_COMMENT, { color: (p) => p.accent2 }),
  T("comment.hint", TS_COMMENT, { color: (p) => p.info }),
  T("comment.info", TS_COMMENT, { color: (p) => p.info }),
  T("comment.warning", TS_COMMENT, { color: (p) => p.warning }),
  T("comment.warn", TS_COMMENT, { color: (p) => p.warning }),
  T("comment.error", TS_COMMENT, { color: (p) => p.error }),

  // --- Markup / diff -----------------------------------------------------
  T("diff.plus", "source.diff markup.inserted.diff"),
  T("diff.minus", "source.diff markup.deleted.diff"),
  T("title", `${MD} markup.heading.markdown`),
  T("title.markup", `${MD} markup.heading.markdown`),
  T("emphasis", `${MD} markup.italic.markdown`),
  T("emphasis.strong", `${MD} markup.bold.markdown`),
  T("strikethrough.markup", [], { color: (p) => p.textMuted }),
  T("text.literal", `${MD} markup.inline.raw.string.markdown`),
  T("link_text", `${MD} string.other.link.title.markdown`, { color: (p) => p.link }),
  T("link_uri", [`${MD} markup.underline.link.markdown`, TS_STRING], { italic: true }),
  T("embedded", "source.ts meta.template.expression.ts"),

  // --- Zed specific ------------------------------------------------------
  T("hint", TS_COMMENT, { color: (p) => p.hint, italic: true }),
  T("predictive", [], { color: (p) => p.predictive }),
  T("primary", [], { color: (p) => p.fg }),
  T("concept", TS_TYPE),
  T("selector", "source.css entity.other.attribute-name.class.css"),
  T("selector.class", "source.css entity.other.attribute-name.class.css"),
  T("selector.id", "source.css entity.other.attribute-name.id.css"),
  T("selector.pseudo", "source.css entity.other.attribute-name.pseudo-class.css"),
  // `text` is intentionally omitted: markdown paragraphs emit @text, and
  // defining it would override the parent style when markdown is injected
  // into doc comments and strings.
];

function fontStyleToZed(fontStyle) {
  const s = typeof fontStyle === "string" ? fontStyle : "";
  return {
    font_style: /\bitalic\b/.test(s) ? "italic" : null,
    font_weight: /\bbold\b/.test(s) ? 700 : null,
  };
}

function buildSyntax(resolve, palette) {
  const syntax = {};
  for (const entry of SYNTAX_MAP) {
    let color;
    let fontStyle;
    for (const scope of entry.scopes) {
      const r = resolve(scope);
      if (r.foreground) {
        color = r.foreground;
        fontStyle = r.fontStyle;
        break;
      }
    }
    if (!color && entry.scopes.length) fontStyle = resolve(entry.scopes[0]).fontStyle;
    if (entry.color) color = typeof entry.color === "function" ? entry.color(palette) : entry.color;
    if (!color) color = palette.fg;

    const style = fontStyleToZed(fontStyle);
    if (entry.italic === true) style.font_style = "italic";
    if (entry.italic === false) style.font_style = null;
    if (entry.weight !== undefined) style.font_weight = entry.weight;

    syntax[entry.key] = { color, ...style };
  }
  return syntax;
}

// ---------------------------------------------------------------------------
// UI palette
// ---------------------------------------------------------------------------

/**
 * Per-family UI defaults. Anything VS Code defines in the variant's `colors`
 * map takes precedence (see `buildPalette`). The "classic" version-control and
 * terminal colors are VS Code's own dark defaults, because that is what the
 * upstream theme shows for them.
 */
export const FAMILY_DEFAULTS = {
  classic: {
    coral: "#e8786d",
    orange: "#e8a86d",
    pink: "#ff78a7",
    cream: "#ffe4b3",
    peach: "#ffa885",
    rose: "#de7a97",
    text: null,
    textMuted: "#a8a8a8",
    textPlaceholder: "#6e6e6e",
    textDisabled: "#5c5c5c",
    hint: "#8a8a8a",
    predictive: "#5e5e5e",
    lineNumber: "#6e6e6e",
    error: "#e73941",
    warning: "#e8a86d",
    info: "#569cd6",
    success: "#b5cea8",
    vcsAdded: "#81b88b",
    vcsModified: "#e2c08d",
    vcsDeleted: "#c74e39",
    vcsRenamed: "#73c991",
    vcsConflict: "#e4676b",
    vcsIgnored: "#8c8c8c",
    accents: ["#e8786d", "#e8a86d", "#ff78a7", "#ffe4b3", "#de7a97", "#569cd6", "#b5cea8"],
    borderMid: "#3d3d3d",
    terminalBright: "#f5f5f5",
    elementHover: "#2c2c2c",
    elementSelectedAlpha: "30",
    players: ["#ff78a7", "#ffe4b3", "#ffa885", "#e8786d", "#de7a97", "#569cd6", "#b5cea8"],
  },
  vibrate: {
    coral: "#f34e3f",
    orange: "#f28118",
    pink: "#ff4788",
    cream: "#ffe4b3",
    peach: "#ffa885",
    rose: "#f395cc",
    text: "#dfcfcf",
    textMuted: "#b89095",
    textPlaceholder: "#7a5a5f",
    textDisabled: "#5e4448",
    hint: "#a07a7f",
    predictive: "#6a4e52",
    lineNumber: "#7a5a5f",
    error: "#ff3768",
    warning: "#ff9317",
    info: "#abb2c0",
    success: "#b5cea8",
    vcsAdded: "#ff4788",
    vcsModified: "#ffe4b3",
    vcsDeleted: "#ef5350",
    vcsRenamed: "#ff9317",
    vcsConflict: "#f395cc",
    vcsIgnored: "#697098",
    accents: ["#ff9317", "#ff4788", "#ffa788", "#f395cc", "#f34e3f", "#abb2c0"],
    borderMid: "#343434",
    terminalBright: "#fafafa",
    elementHover: "#ff931726",
    elementSelectedAlpha: "40",
    players: ["#ff4788", "#ffe4b3", "#ffa885", "#f34e3f", "#f395cc", "#abb2c0", "#ffd077"],
  },
};

/** VS Code's default dark terminal palette (Modern Oranges does not override it). */
const VSCODE_ANSI = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  bright_black: "#666666",
  bright_red: "#f14c4c",
  bright_green: "#23d18b",
  bright_yellow: "#f5f543",
  bright_blue: "#3b8eea",
  bright_magenta: "#d670d6",
  bright_cyan: "#29b8db",
  bright_white: "#e5e5e5",
};

/** Build the UI palette for one variant from its VS Code theme. */
export function buildPalette(vsTheme, variant) {
  const c = vsTheme.colors ?? {};
  const d = FAMILY_DEFAULTS[variant.family];
  const get = (key) => normalizeColor(c[key]);
  const getOpaque = (key) => opaque(c[key]);

  const bg = getOpaque("editor.background") ?? "#1f1f1f";
  const fg = getOpaque("editor.foreground") ?? "#d4d4d4";
  const accent = getOpaque("tab.activeForeground") ?? d.coral;
  const accent2 = getOpaque("sideBarTitle.foreground") ?? d.orange;
  const elevated = getOpaque("editorSuggestWidget.background") ?? getOpaque("sideBar.background") ?? bg;

  const bracketAccents = [1, 2, 3, 4, 5, 6]
    .map((i) => getOpaque(`editorBracketHighlight.foreground${i}`))
    .filter(Boolean);

  return {
    family: variant.family,
    bg,
    fg,
    accent,
    accent2,
    pink: d.pink,
    cream: d.cream,
    peach: d.peach,
    rose: d.rose,
    chrome: getOpaque("titleBar.activeBackground") ?? bg,
    sidebar: getOpaque("sideBar.background") ?? bg,
    panel: getOpaque("panel.background") ?? bg,
    elevated,
    text: d.text ?? getOpaque("quickInput.foreground") ?? fg,
    textMuted: d.textMuted,
    textPlaceholder: d.textPlaceholder,
    textDisabled: d.textDisabled,
    textAccent: getOpaque("list.highlightForeground") ?? accent2,
    link: getOpaque("textLink.foreground") ?? accent2,
    hint: d.hint,
    predictive: d.predictive,
    lineNumber: d.lineNumber,
    borderMid: getOpaque("button.background") ?? d.borderMid,
    borderFocused: getOpaque("focusBorder") ?? accent,
    selection: get("editor.selectionBackground") ?? "#9c705e48",
    selectionHighlight: get("editor.selectionHighlightBackground") ?? "#9c173f26",
    indentGuide: getOpaque("editorIndentGuide.background") ?? "#404040",
    indentGuideActive: getOpaque("editorIndentGuide.activeBackground") ?? "#707070",
    scrollbar: getOpaque("scrollbarSlider.background") ?? d.peach,
    scrollbarHover: get("scrollbarSlider.hoverBackground") ?? withAlpha(d.pink, "81"),
    scrollbarActive: getOpaque("scrollbarSlider.activeBackground") ?? accent,
    searchMatch: getOpaque("searchEditor.findMatchBackground") ?? "#835353",
    elementHover: get("list.hoverBackground") ?? d.elementHover,
    elementSelected: withAlpha(
      getOpaque("quickInputList.focusBackground") ?? getOpaque("list.activeSelectionBackground") ?? accent,
      d.elementSelectedAlpha,
    ),
    error: getOpaque("editorError.foreground") ?? d.error,
    warning: getOpaque("editorWarning.foreground") ?? d.warning,
    info: d.info,
    success: d.success,
    vcsAdded: getOpaque("gitDecoration.untrackedResourceForeground") ?? d.vcsAdded,
    vcsModified: getOpaque("gitDecoration.modifiedResourceForeground") ?? d.vcsModified,
    vcsDeleted: getOpaque("gitDecoration.deletedResourceForeground") ?? d.vcsDeleted,
    vcsRenamed: d.vcsRenamed,
    vcsConflict: getOpaque("gitDecoration.conflictingResourceForeground") ?? d.vcsConflict,
    // Ignored files (project panel, git panel) use the comment color instead of
    // VS Code's blue-gray ignoredResourceForeground, to stay in the warm palette.
    vcsIgnored: createScopeResolver(vsTheme.tokenColors ?? [])(TS_COMMENT).foreground ?? d.vcsIgnored,
    accents: bracketAccents.length >= 4 ? bracketAccents : d.accents,
    players: d.players,
    terminalFg: getOpaque("terminal.foreground") ?? fg,
    terminalBright: d.terminalBright,
    ansi: VSCODE_ANSI,
  };
}

// ---------------------------------------------------------------------------
// Full Zed style (opaque base) and blur overrides
// ---------------------------------------------------------------------------

function buildBaseStyle(p, syntax) {
  const s = {};

  s.accents = p.accents;

  for (const mode of [
    "normal",
    "helix_normal",
    "visual",
    "helix_select",
    "insert",
    "visual_line",
    "visual_block",
    "replace",
  ]) {
    s[`vim.${mode}.foreground`] = p.bg;
  }
  s["vim.mode.text"] = p.bg;
  s["vim.normal.background"] = p.accent2;
  s["vim.helix_normal.background"] = p.accent2;
  s["vim.visual.background"] = p.pink;
  s["vim.helix_select.background"] = p.pink;
  s["vim.insert.background"] = p.success;
  s["vim.visual_line.background"] = p.pink;
  s["vim.visual_block.background"] = p.accent;
  s["vim.replace.background"] = p.error;

  s["background.appearance"] = "opaque";
  s.border = p.borderMid;
  s["border.variant"] = p.borderMid;
  s["border.focused"] = p.borderFocused;
  s["border.selected"] = p.accent;
  s["border.transparent"] = "#00000000";
  s["border.disabled"] = p.textDisabled;
  s["elevated_surface.background"] = p.elevated;
  s["surface.background"] = p.elevated;
  s.background = p.bg;
  s["element.background"] = p.elevated;
  s["element.hover"] = p.elementHover;
  s["element.active"] = withAlpha(p.accent, "26");
  s["element.selected"] = p.elementSelected;
  s["element.disabled"] = p.textDisabled;
  s["drop_target.background"] = withAlpha(p.accent, "33");
  s["ghost_element.background"] = "#00000000";
  s["ghost_element.hover"] = p.elementHover;
  s["ghost_element.active"] = withAlpha(p.accent, "30");
  s["ghost_element.selected"] = withAlpha(p.accent, "50");
  s["ghost_element.disabled"] = p.textDisabled;
  s.text = p.text;
  s["text.muted"] = p.textMuted;
  s["text.placeholder"] = p.textPlaceholder;
  s["text.disabled"] = p.textDisabled;
  s["text.accent"] = p.textAccent;
  s.icon = p.text;
  s["icon.muted"] = p.textMuted;
  s["icon.disabled"] = p.textDisabled;
  s["icon.placeholder"] = p.textPlaceholder;
  s["icon.accent"] = p.accent;
  s["status_bar.background"] = p.chrome;
  s["title_bar.background"] = p.chrome;
  s["title_bar.inactive_background"] = p.chrome;
  s["toolbar.background"] = p.bg;
  s["tab_bar.background"] = p.chrome;
  s["tab.inactive_background"] = p.chrome;
  s["tab.active_background"] = p.bg;
  s["search.match_background"] = withAlpha(p.searchMatch, "80");
  s["search.active_match_background"] = withAlpha(p.accent, "66");
  s["panel.background"] = p.sidebar;
  s["panel.focused_border"] = p.accent;
  s["panel.indent_guide"] = withAlpha(p.indentGuide, "99");
  s["panel.indent_guide_active"] = p.indentGuideActive;
  s["panel.indent_guide_hover"] = p.accent;
  s["panel.overlay_background"] = p.sidebar;
  s["pane.focused_border"] = p.accent;
  s["pane_group.border"] = p.borderMid;
  s["scrollbar.thumb.background"] = withAlpha(p.scrollbar, "2d");
  s["scrollbar.thumb.hover_background"] = p.scrollbarHover;
  s["scrollbar.thumb.active_background"] = p.scrollbarActive;
  s["scrollbar.thumb.border"] = null;
  s["scrollbar.track.background"] = "#00000000";
  s["scrollbar.track.border"] = withAlpha(p.borderMid, "15");
  s["minimap.thumb.background"] = withAlpha(p.accent, "33");
  s["minimap.thumb.hover_background"] = withAlpha(p.accent, "66");
  s["minimap.thumb.active_background"] = withAlpha(p.accent, "99");
  s["minimap.thumb.border"] = null;
  s["editor.foreground"] = p.fg;
  s["editor.background"] = p.bg;
  s["editor.gutter.background"] = p.bg;
  s["editor.subheader.background"] = p.elevated;
  s["editor.active_line.background"] = "#ffffff08";
  s["editor.highlighted_line.background"] = null;
  s["editor.line_number"] = p.lineNumber;
  s["editor.active_line_number"] = p.accent;
  s["editor.hover_line_number"] = p.textMuted;
  s["editor.invisible"] = withAlpha(p.textMuted, "40");
  s["editor.wrap_guide"] = p.indentGuide;
  s["editor.active_wrap_guide"] = p.indentGuideActive;
  s["editor.document_highlight.bracket_background"] = withAlpha(p.selection, "30");
  s["editor.document_highlight.read_background"] = p.selectionHighlight;
  s["editor.document_highlight.write_background"] = withAlpha(p.selectionHighlight, "40");
  s["editor.indent_guide"] = p.indentGuide;
  s["editor.indent_guide_active"] = p.indentGuideActive;
  s["terminal.background"] = p.panel;
  s["terminal.ansi.background"] = p.bg;
  s["terminal.foreground"] = p.terminalFg;
  s["terminal.dim_foreground"] = p.textMuted;
  s["terminal.bright_foreground"] = p.terminalBright;
  for (const name of ["black", "white", "red", "green", "yellow", "blue", "magenta", "cyan"]) {
    s[`terminal.ansi.${name}`] = p.ansi[name];
    s[`terminal.ansi.bright_${name}`] = p.ansi[`bright_${name}`];
    s[`terminal.ansi.dim_${name}`] = mix(p.ansi[name], p.bg, 0.5);
  }
  s["link_text.hover"] = p.link;

  const status = (key, color, bgAlpha = "26") => {
    s[key] = color;
    s[`${key}.border`] = color;
    s[`${key}.background`] = withAlpha(color, bgAlpha);
  };
  status("conflict", p.vcsConflict);
  status("created", p.vcsAdded);
  status("deleted", p.vcsDeleted);
  s.hidden = p.textDisabled;
  s["hidden.border"] = p.textDisabled;
  s["hidden.background"] = p.elevated;
  s.hint = p.hint;
  s["hint.border"] = p.hint;
  s["hint.background"] = p.elevated;
  status("ignored", p.vcsIgnored);
  status("modified", p.vcsModified);
  s.predictive = p.predictive;
  s["predictive.border"] = p.accent;
  s["predictive.background"] = p.elevated;
  status("renamed", p.vcsRenamed);
  status("info", p.info);
  status("warning", p.warning);
  status("error", p.error);
  status("success", p.success);
  status("unreachable", p.textMuted, "1f");

  s.players = [
    { cursor: p.accent2, selection: p.selection, background: p.accent2 },
    ...p.players.map((color) => ({ cursor: color, selection: withAlpha(color, "4d"), background: color })),
  ];

  s["version_control.added"] = p.vcsAdded;
  s["version_control.deleted"] = p.vcsDeleted;
  s["version_control.modified"] = p.vcsModified;
  s["version_control.renamed"] = p.vcsRenamed;
  s["version_control.conflict"] = p.vcsConflict;
  s["version_control.conflict_marker.ours"] = withAlpha(p.vcsAdded, "33");
  s["version_control.conflict_marker.theirs"] = withAlpha(p.info, "33");
  s["version_control.ignored"] = p.vcsIgnored;
  s["debugger.accent"] = p.error;
  s["editor.debugger_active_line.background"] = withAlpha(p.warning, "12");

  s.syntax = syntax;
  return s;
}

/**
 * Blur overrides for a Modern Oranges variant, written with medium-level
 * alphas. `generateThemeOverridesForLevel` substitutes the per-level alphas.
 */
export function buildBlurOverrides(p) {
  const tint = (color) => mix(color, p.bg, 0.8);
  return {
    "background.appearance": "blurred",
    background: withAlpha(p.bg, "d7"),
    "status_bar.background": withAlpha(p.bg, "d7"),
    "title_bar.background": withAlpha(p.bg, "d7"),
    "title_bar.inactive_background": withAlpha(p.bg, "d7"),
    "elevated_surface.background": p.elevated,
    "surface.background": withAlpha(p.bg, "d0"),
    border: withAlpha(p.borderMid, "15"),
    "hint.background": withAlpha(p.elevated, "c0"),
    "editor.background": "#00000000",
    "editor.line_number": "#ffffff20",
    "editor.active_line_number": withAlpha(p.accent, "90"),
    "editor.gutter.background": "#00000000",
    "tab_bar.background": "#00000000",
    "terminal.background": "#00000000",
    "toolbar.background": "#00000000",
    "tab.active_background": withAlpha(p.elevated, "60"),
    "tab.inactive_background": "#00000000",
    "panel.background": "#00000000",
    "panel.focused_border": "#00000000",
    "panel.overlay_background": p.bg,
    "pane_group.border": withAlpha(p.borderMid, "15"),
    "pane.focused_border": withAlpha(p.borderMid, "10"),
    "element.active": "#00000000",
    "border.variant": "#00000000",
    "scrollbar.track.border": "#00000000",
    "editor.active_line.background": "#00000000",
    "scrollbar.track.background": "#00000000",
    "scrollbar.thumb.background": withAlpha(p.scrollbar, "30"),
    "ghost_element.background": withAlpha(p.elevated, "60"),
    "ghost_element.hover": withAlpha(p.elevated, "90"),
    "ghost_element.active": withAlpha(p.accent, "30"),
    "ghost_element.selected": withAlpha(p.accent, "50"),
    "drop_target.background": withAlpha(p.accent, "20"),
    "editor.highlighted_line.background": withAlpha(p.accent, "12"),
    "error.background": tint(p.error),
    "warning.background": tint(p.warning),
    "info.background": tint(p.info),
    "success.background": tint(p.success),
  };
}

/**
 * Build all Modern Oranges Zed themes.
 *
 * @param {Record<string, object>} sources  VS Code theme JSON per variant key.
 * @returns {{ families: object, debug: object }} the Zed theme family and a
 *   per-variant summary of the resolved palette and syntax (for the sync log).
 */
export function buildModernOrangesThemes(sources) {
  const themes = [];
  const summary = {};

  const prepared = MODERN_ORANGES_VARIANTS.map((variant) => {
    const vs = sources[variant.key];
    if (!vs) throw new Error(`Missing Modern Oranges source for variant "${variant.key}"`);
    const resolve = createScopeResolver(vs.tokenColors ?? []);
    const palette = buildPalette(vs, variant);
    const syntax = buildSyntax(resolve, palette);
    const base = buildBaseStyle(palette, syntax);
    const blur = buildBlurOverrides(palette);
    summary[variant.key] = { palette, syntax };
    return { variant, base, blur };
  });

  for (const [levelName, levelConfig] of Object.entries(BLUR_LEVELS)) {
    for (const { variant, base, blur } of prepared) {
      const style = {
        ...base,
        ...generateThemeOverridesForLevel(blur, levelConfig),
        ...(VARIANT_STYLE_OVERRIDES[variant.key] ?? {}),
      };
      themes.push({ name: blurVariantName(variant.name, levelName), appearance: "dark", style });
    }
  }

  return {
    family: {
      $schema: "https://zed.dev/schema/themes/v0.2.0.json",
      name: MODERN_ORANGES_FAMILY_NAME,
      author: MODERN_ORANGES_AUTHOR,
      themes,
    },
    summary,
  };
}
