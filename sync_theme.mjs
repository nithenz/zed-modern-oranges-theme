#!/usr/bin/env node
/**
 * Theme sync for Modern Oranges.
 *
 * Fetches the upstream Modern Oranges VS Code theme files, converts them to
 * Zed themes with the blur overrides (modern_oranges.mjs + blur.mjs), validates
 * the result and writes themes/modern-oranges-blur.json.
 *
 * Usage:
 *   node sync_theme.mjs                      fetch upstream, build, validate, write
 *   node sync_theme.mjs --offline            use only the .cache/ copies of upstream
 *   node sync_theme.mjs --modern-oranges DIR use a local modern-oranges-theme/themes dir
 *   node sync_theme.mjs --check              build and fail if the committed file differs
 *   node sync_theme.mjs --validate           only validate the committed file (no network)
 *   node sync_theme.mjs --verbose            print the resolved colors per variant
 *
 * No dependencies beyond Node 20+.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MODERN_ORANGES_SOURCE_BASE,
  MODERN_ORANGES_VARIANTS,
  buildModernOrangesThemes,
  parseJsonc,
} from "./modern_oranges.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(ROOT, ".cache");
const OUTPUT = path.join(ROOT, "themes", "modern-oranges-blur.json");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { offline: false, check: false, validate: false, verbose: false, color: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") args.offline = true;
    else if (a === "--check") args.check = true;
    else if (a === "--validate") args.validate = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--no-color") args.color = false;
    else if (a === "--modern-oranges") args.modernOranges = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log("Usage: node sync_theme.mjs [--offline] [--check] [--validate] [--verbose] [--modern-oranges DIR]");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));

const C = ARGS.color && process.stdout.isTTY !== false
  ? {
      blue: "\x1b[94m",
      green: "\x1b[92m",
      yellow: "\x1b[93m",
      red: "\x1b[91m",
      purple: "\x1b[95m",
      cyan: "\x1b[96m",
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
    }
  : new Proxy({}, { get: () => "" });

const ICONS = {
  info: `${C.blue}ℹ${C.reset}`,
  success: `${C.green}✓${C.reset}`,
  error: `${C.red}✗${C.reset}`,
  warning: `${C.yellow}⚠${C.reset}`,
  processing: `${C.cyan}◆${C.reset}`,
};

function step(message, status = "info") {
  console.log(`${ICONS[status] ?? ICONS.info} ${message}`);
}

function header() {
  console.log(`\n${C.purple}╭${"─".repeat(50)}╮${C.reset}`);
  console.log(`${C.purple}│${C.reset} ${C.bold}🍊 Modern Oranges Theme Sync${C.reset}${" ".repeat(21)}${C.purple}│${C.reset}`);
  console.log(`${C.purple}╰${"─".repeat(50)}╯${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// Fetching with cache
// ---------------------------------------------------------------------------

async function fetchText(url, cacheName) {
  const cachePath = path.join(CACHE_DIR, cacheName);

  if (ARGS.offline) {
    if (!existsSync(cachePath)) throw new Error(`--offline but no cached copy at ${cachePath}`);
    step(`Using cached ${cacheName} (offline)`, "info");
    return fs.readFile(cachePath, "utf8");
  }

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath, text);
    step(`Fetched ${cacheName} (${(text.length / 1024).toFixed(1)} KB)`, "success");
    return text;
  } catch (error) {
    if (existsSync(cachePath)) {
      step(`Failed to fetch ${url} (${error.message}); using cached copy`, "warning");
      return fs.readFile(cachePath, "utf8");
    }
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

async function loadSources() {
  const sources = {};
  for (const variant of MODERN_ORANGES_VARIANTS) {
    const text = ARGS.modernOranges
      ? await fs.readFile(path.join(ARGS.modernOranges, variant.file), "utf8")
      : await fetchText(MODERN_ORANGES_SOURCE_BASE + variant.file, `modern-oranges-${variant.file}`);
    sources[variant.key] = parseJsonc(text);
  }
  if (ARGS.modernOranges) {
    step(`Read ${MODERN_ORANGES_VARIANTS.length} Modern Oranges files from ${ARGS.modernOranges}`, "info");
  }
  return sources;
}

function printSummary(summary) {
  const keys = ["keyword", "keyword.declaration", "keyword.control", "variable", "property", "function", "type", "string", "number", "comment"];
  for (const [variantKey, { palette, syntax }] of Object.entries(summary)) {
    console.log(`\n  ${C.bold}${variantKey}${C.reset}  bg ${palette.bg}  accent ${palette.accent}  elevated ${palette.elevated}`);
    for (const key of keys) {
      const s = syntax[key];
      const style = [s.font_style, s.font_weight].filter(Boolean).join(" ");
      console.log(`    ${key.padEnd(20)} ${s.color}${style ? `  ${C.dim}${style}${C.reset}` : ""}`);
    }
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Validation (structural; no schema download needed)
// ---------------------------------------------------------------------------

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FONT_STYLES = new Set(["normal", "italic", "oblique"]);
const APPEARANCES = new Set(["opaque", "transparent", "blurred", "mica_backdrop", "mica_alt_backdrop"]);

/**
 * Style keys accepted by Zed's theme schema (v0.2.0), collected from Zed's
 * bundled themes. Unknown keys are reported as warnings, not errors, so newer
 * Zed keys do not break the build.
 */
const KNOWN_STYLE_KEYS = new Set([
  "accents", "background", "background.appearance", "border", "border.disabled", "border.focused", "border.selected",
  "border.transparent", "border.variant", "conflict", "conflict.background", "conflict.border", "created",
  "created.background", "created.border", "debugger.accent", "deleted", "deleted.background", "deleted.border",
  "drop_target.background", "editor.active_line.background", "editor.active_line_number", "editor.active_wrap_guide",
  "editor.background", "editor.debugger_active_line.background", "editor.document_highlight.bracket_background",
  "editor.document_highlight.read_background", "editor.document_highlight.write_background", "editor.foreground",
  "editor.gutter.background", "editor.highlighted_line.background", "editor.hover_line_number", "editor.indent_guide",
  "editor.indent_guide_active", "editor.invisible", "editor.line_number", "editor.subheader.background",
  "editor.wrap_guide", "element.active", "element.background", "element.disabled", "element.hover", "element.selected",
  "elevated_surface.background", "error", "error.background", "error.border", "ghost_element.active",
  "ghost_element.background", "ghost_element.disabled", "ghost_element.hover", "ghost_element.selected", "hidden",
  "hidden.background", "hidden.border", "hint", "hint.background", "hint.border", "icon", "icon.accent", "icon.disabled",
  "icon.muted", "icon.placeholder", "ignored", "ignored.background", "ignored.border", "info", "info.background",
  "info.border", "link_text.hover", "minimap.thumb.active_background", "minimap.thumb.background",
  "minimap.thumb.border", "minimap.thumb.hover_background", "modified", "modified.background", "modified.border",
  "pane.focused_border", "pane_group.border", "panel.background", "panel.focused_border", "panel.indent_guide",
  "panel.indent_guide_active", "panel.indent_guide_hover", "panel.overlay_background", "players", "predictive",
  "predictive.background", "predictive.border", "renamed", "renamed.background", "renamed.border",
  "scrollbar.thumb.active_background", "scrollbar.thumb.background", "scrollbar.thumb.border",
  "scrollbar.thumb.hover_background", "scrollbar.track.background", "scrollbar.track.border",
  "search.active_match_background", "search.match_background", "status_bar.background", "success",
  "success.background", "success.border", "surface.background", "syntax", "tab.active_background",
  "tab_bar.background", "tab.inactive_background", "terminal.ansi.background", "terminal.ansi.black",
  "terminal.ansi.blue", "terminal.ansi.bright_black", "terminal.ansi.bright_blue", "terminal.ansi.bright_cyan",
  "terminal.ansi.bright_green", "terminal.ansi.bright_magenta", "terminal.ansi.bright_red",
  "terminal.ansi.bright_white", "terminal.ansi.bright_yellow", "terminal.ansi.cyan", "terminal.ansi.dim_black",
  "terminal.ansi.dim_blue", "terminal.ansi.dim_cyan", "terminal.ansi.dim_green", "terminal.ansi.dim_magenta",
  "terminal.ansi.dim_red", "terminal.ansi.dim_white", "terminal.ansi.dim_yellow", "terminal.ansi.green",
  "terminal.ansi.magenta", "terminal.ansi.red", "terminal.ansi.white", "terminal.ansi.yellow", "terminal.background",
  "terminal.bright_foreground", "terminal.dim_foreground", "terminal.foreground", "text", "text.accent",
  "text.disabled", "text.muted", "text.placeholder", "title_bar.background", "title_bar.inactive_background",
  "toolbar.background", "unreachable", "unreachable.background", "unreachable.border", "version_control.added",
  "version_control.conflict", "version_control.conflict_marker.ours", "version_control.conflict_marker.theirs",
  "version_control.deleted", "version_control.ignored", "version_control.modified", "version_control.renamed",
  "version_control.word_added", "version_control.word_deleted", "vim.helix_normal.background",
  "vim.helix_normal.foreground", "vim.helix_select.background", "vim.helix_select.foreground",
  "vim.insert.background", "vim.insert.foreground", "vim.mode.text", "vim.normal.background",
  "vim.normal.foreground", "vim.replace.background", "vim.replace.foreground", "vim.visual.background",
  "vim.visual_block.background", "vim.visual_block.foreground", "vim.visual.foreground",
  "vim.visual_line.background", "vim.visual_line.foreground", "warning", "warning.background", "warning.border",
]);

function isColorOrNull(value) {
  return value === null || (typeof value === "string" && COLOR_RE.test(value));
}

function validateFamily(family) {
  const errors = [];
  const warnings = [];

  if (typeof family?.name !== "string" || !family.name) errors.push("missing family name");
  if (typeof family?.author !== "string" || !family.author) errors.push("missing family author");
  if (!Array.isArray(family?.themes) || family.themes.length === 0) {
    errors.push("no themes");
    return { errors, warnings };
  }

  const names = new Set();
  family.themes.forEach((theme, i) => {
    const where = `themes[${i}] "${theme?.name ?? "?"}"`;
    if (typeof theme?.name !== "string" || !theme.name) errors.push(`${where}: missing name`);
    if (names.has(theme?.name)) errors.push(`${where}: duplicate theme name`);
    names.add(theme?.name);
    if (theme?.appearance !== "light" && theme?.appearance !== "dark") errors.push(`${where}: bad appearance`);
    if (!theme?.style || typeof theme.style !== "object") {
      errors.push(`${where}: missing style`);
      return;
    }

    for (const [key, value] of Object.entries(theme.style)) {
      if (!KNOWN_STYLE_KEYS.has(key)) warnings.push(`${where}: unknown style key "${key}"`);

      if (key === "syntax") {
        if (!value || typeof value !== "object") {
          errors.push(`${where}: syntax must be an object`);
          continue;
        }
        for (const [capture, hl] of Object.entries(value)) {
          if (!hl || typeof hl !== "object") {
            errors.push(`${where}: syntax.${capture} must be an object`);
            continue;
          }
          if (hl.color !== undefined && !isColorOrNull(hl.color)) errors.push(`${where}: syntax.${capture}.color invalid: ${hl.color}`);
          if (hl.background_color !== undefined && !isColorOrNull(hl.background_color)) {
            errors.push(`${where}: syntax.${capture}.background_color invalid: ${hl.background_color}`);
          }
          if (hl.font_style !== undefined && hl.font_style !== null && !FONT_STYLES.has(hl.font_style)) {
            errors.push(`${where}: syntax.${capture}.font_style invalid: ${hl.font_style}`);
          }
          if (hl.font_weight !== undefined && hl.font_weight !== null && typeof hl.font_weight !== "number") {
            errors.push(`${where}: syntax.${capture}.font_weight invalid: ${hl.font_weight}`);
          }
        }
      } else if (key === "players") {
        if (!Array.isArray(value)) {
          errors.push(`${where}: players must be an array`);
          continue;
        }
        value.forEach((player, p) => {
          for (const field of ["cursor", "selection", "background"]) {
            if (player?.[field] !== undefined && !isColorOrNull(player[field])) {
              errors.push(`${where}: players[${p}].${field} invalid: ${player[field]}`);
            }
          }
        });
      } else if (key === "accents") {
        if (!Array.isArray(value) || !value.every((c) => typeof c === "string" && COLOR_RE.test(c))) {
          errors.push(`${where}: accents must be an array of colors`);
        }
      } else if (key === "background.appearance") {
        if (!APPEARANCES.has(value)) errors.push(`${where}: background.appearance invalid: ${value}`);
      } else if (!isColorOrNull(value)) {
        errors.push(`${where}: ${key} is not a color: ${JSON.stringify(value)}`);
      }
    }
  });

  return { errors, warnings };
}

function report({ errors, warnings }) {
  for (const w of warnings) step(w, "warning");
  if (errors.length) {
    for (const e of errors) step(e, "error");
    step(`Validation failed (${errors.length} error${errors.length === 1 ? "" : "s"})`, "error");
    return false;
  }
  step("Validation passed", "success");
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

async function main() {
  header();
  const started = Date.now();
  const rel = path.relative(ROOT, OUTPUT);

  if (ARGS.validate) {
    const text = await readIfExists(OUTPUT);
    if (text === null) {
      step(`${rel}: missing`, "error");
      process.exit(1);
    }
    process.exit(report(validateFamily(JSON.parse(text))) ? 0 : 1);
  }

  const { family, summary } = buildModernOrangesThemes(await loadSources());
  step(`Built ${family.themes.length} variants`, "success");
  if (ARGS.verbose) printSummary(summary);

  if (!report(validateFamily(family))) {
    step("Aborting: validation failed", "error");
    process.exit(1);
  }

  const content = `${JSON.stringify(family, null, 2)}\n`;
  const existing = await readIfExists(OUTPUT);
  const changed = existing === null || sha256(existing) !== sha256(content);

  if (!changed) {
    step(`${rel}: no changes`, "info");
  } else if (ARGS.check) {
    step(`${rel}: committed file is out of date. Run: node sync_theme.mjs`, "error");
    process.exit(1);
  } else {
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, content);
    step(`${rel}: written (${(content.length / 1024).toFixed(1)} KB)`, "success");
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(2);
  const color = changed ? C.green : C.blue;
  console.log(`\n${color}${changed ? "✨ Theme synchronization complete!" : "ℹ Theme is already up to date"}${C.reset}`);
  console.log(`${C.dim}   • Variants: ${family.themes.length}  • Time: ${elapsed}s${C.reset}\n`);
}

main().catch((error) => {
  console.error(`\n${C.red}✗ Failed to update theme:${C.reset} ${error.message}`);
  if (ARGS.verbose) console.error(error.stack);
  process.exit(1);
});
