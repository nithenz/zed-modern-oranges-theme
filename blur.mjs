/**
 * Blur levels and helpers.
 *
 * Ported from `theme_overrides.py` in
 * https://github.com/jenslys/zed-catppuccin-blur, so the Modern Oranges
 * variants use the same blur technique and the same three blur levels as
 * Catppuccin Blur.
 */

/**
 * Blur intensity levels. Each value is a two-digit hex alpha channel that is
 * substituted into the matching override colors. Higher = more opaque.
 *
 *  - main:     window background, status bar, title bar
 *  - surface:  surface backgrounds
 *  - elements: scrollbar thumbs, hover / selected element backgrounds
 *  - active:   active tab background, drop targets
 */
export const BLUR_LEVELS = {
  light: { main: "99", surface: "8c", elements: "80", active: "90" }, // ~60% opacity for main
  medium: { main: "d7", surface: "d0", elements: "a0", active: "b0" }, // ~85% opacity for main (default)
  heavy: { main: "e0", surface: "db", elements: "c0", active: "d0" }, // ~88% opacity for main
};

/** The level that gets the plain "(Blur)" name without a bracketed suffix. */
export const DEFAULT_BLUR_LEVEL = "medium";

/**
 * Build the overrides for one blur level from a set of base overrides.
 *
 * Every 9-character color (`#rrggbbaa`) in the base overrides has its alpha
 * channel replaced according to which UI element the key describes. Keys that
 * do not match any rule (and 7-character opaque colors) are left untouched.
 * `ghost_element.*` colors are intentionally kept as-is so buttons stay solid.
 */
export function generateThemeOverridesForLevel(baseOverrides, levelConfig) {
  const overrides = { ...baseOverrides };

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== "string" || value.length !== 9 || !value.startsWith("#")) continue;

    const baseColor = value.slice(0, 7);

    if (
      key.includes("background") &&
      (key.includes("status_bar") || key.includes("title_bar") || key === "background")
    ) {
      overrides[key] = baseColor + levelConfig.main;
    } else if (key.includes("surface")) {
      overrides[key] = baseColor + levelConfig.surface;
    } else if (["drop_target", "tab.active"].some((e) => key.includes(e))) {
      overrides[key] = baseColor + levelConfig.active;
    } else if (
      ["thumb", "hover", "selected"].some((e) => key.includes(e)) &&
      !key.includes("ghost_element")
    ) {
      overrides[key] = baseColor + levelConfig.elements;
    }
  }

  return overrides;
}

/**
 * Name a variant for a given blur level: "Foo (Blur)" for the default level,
 * "Foo (Blur) [Light]" and "Foo (Blur) [Heavy]" for the others.
 */
export function blurVariantName(baseName, levelName) {
  if (levelName === DEFAULT_BLUR_LEVEL) return `${baseName} (Blur)`;
  const label = levelName.charAt(0).toUpperCase() + levelName.slice(1);
  return `${baseName} (Blur) [${label}]`;
}
