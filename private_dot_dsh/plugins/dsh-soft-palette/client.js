/**
 * Soft palette: one ThemeRuntime override layer that lowers alias-token
 * contrast in both palettes. Dark mode drops body text from ~18:1 to ~9:1
 * and lifts the canvas a step; light mode only softens primary text. The
 * layer rides ctx.effect, so disabling or removing the plugin restores the
 * built-in palettes exactly.
 */
globalThis.__ModuleLoader__.load({
  id: "dsh-soft-palette",
  factory() {
    const LAYER = "dsh-soft-palette";
    const TOKENS = {
      "--dsw-alias-label-primary": { light: "#2b2f36", dark: "#bcc3cd" },
      "--dsw-alias-label-secondary": { light: "#cfd3d6", dark: "#8a9099" },
      "--dsw-alias-bg-base": { light: "#ffffff", dark: "#1e2126" },
      "--dsw-alias-bg-layer-1": { light: "#ffffff", dark: "#2c2f34" },
      "--dsw-alias-bg-layer-2": { light: "#ffffff", dark: "#35383d" },
      "--dsw-alias-border-l1": { light: "#0000000a", dark: "#ffffff0d" },
      "--dsw-alias-border-l2": { light: "#0000001a", dark: "#ffffff1a" },
    };
    return {
      inject: ["theme"],
      apply(ctx) {
        ctx.effect(() => ctx.theme.overrideTokens(LAYER, TOKENS));
      },
    };
  },
});
