import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** The theme folders: light while the device is in light mode, and dark while it is in dark mode. */
export interface ThemeFolders {
  light: string;
  dark: string;
}

/** How the library looks: its name, and its themes. */
export interface AppearanceSettings {
  siteName: string;
  themes: ThemeFolders;
}

/** The look of albireo: its name, and the themes that it comes with. */
export const APPEARANCE: AppearanceSettings = {
  siteName: "albireo",
  themes: { light: "./themes/light", dark: "./themes/dark" },
};

const APPEARANCE_MODULE = "virtual:albireo-appearance";
const DARK_THEME_MODULE = "virtual:albireo-dark-theme.css";
const THEME_FILES = ["theme.css", "logo.svg"];

// Builds the look of the library from its appearance. The browser app
// imports virtual:albireo-appearance, which loads theme.css of the light theme, then
// theme.css of the dark theme inside a media query for dark mode, and gives the site
// name and the URLs of both logos. The page follows the mode of the device, and
// switches with it at once. The demo (vite.demo.config.ts) builds its look with it too.
export function albireoAppearance(appearance: AppearanceSettings): Plugin {
  const light = themeFolder(appearance.themes, "light");
  const dark = themeFolder(appearance.themes, "dark");
  const darkCss = resolve(dark, "theme.css");
  const resolvedId = `\0${APPEARANCE_MODULE}`;
  const resolvedDarkId = `\0${DARK_THEME_MODULE}`;
  return {
    name: "albireo-appearance",
    resolveId: (source) => (source === APPEARANCE_MODULE ? resolvedId : source === DARK_THEME_MODULE ? resolvedDarkId : undefined),
    load(id) {
      // The variables of the dark theme replace those of the light one while the device is in dark mode.
      if (id === resolvedDarkId) {
        this.addWatchFile(darkCss);
        return `@media (prefers-color-scheme: dark) {\n${readFileSync(darkCss, "utf8")}\n}\n`;
      }
      if (id !== resolvedId) return undefined;
      this.addWatchFile(resolve(light, "logo.svg"));
      this.addWatchFile(resolve(dark, "logo.svg"));
      const favicon = faviconOf(resolve(light, "logo.svg"), resolve(dark, "logo.svg"));
      return [
        `import ${JSON.stringify(resolve(light, "theme.css"))};`,
        `import ${JSON.stringify(DARK_THEME_MODULE)};`,
        `import logo from ${JSON.stringify(resolve(light, "logo.svg"))};`,
        `import darkLogo from ${JSON.stringify(resolve(dark, "logo.svg"))};`,
        `export default { siteName: ${JSON.stringify(appearance.siteName)}, logo, darkLogo, favicon: ${JSON.stringify(favicon)} };`,
      ].join("\n");
    },
    transformIndexHtml: (html) => html.replace("<title>albireo</title>", `<title>${escapeHtml(appearance.siteName)}</title>`),
  };
}

// The icon of the browser tab: the logo of the light theme, and the logo of the dark theme
// while the browser is in dark mode, since a dark tab hides a dark logo. An icon is an
// image, which loads nothing from outside, so both logos go inside it as data. A tab draws
// the icon at 16 pixels, where a logo with room around its mark looks small beside the
// icons of other sites, so the icon shows the middle of the logo, FAVICON_ZOOM times as large.
const FAVICON_ZOOM = 1.3;

function faviconOf(lightLogo: string, darkLogo: string): string {
  const size = 64 * FAVICON_ZOOM;
  const offset = (64 - size) / 2;
  const logo = (path: string, mode: string) =>
    `<image class="${mode}" x="${offset}" y="${offset}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${readFileSync(path).toString("base64")}"/>`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    "<style>.dark{display:none}@media (prefers-color-scheme: dark){.light{display:none}.dark{display:inline}}</style>" +
    `${logo(lightLogo, "light")}${logo(darkLogo, "dark")}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// The theme folder of a mode of the device, after checking that it has every file of a theme.
function themeFolder(themes: ThemeFolders, mode: keyof ThemeFolders): string {
  const folder = resolve(themes[mode]);
  const missing = THEME_FILES.filter((file) => !existsSync(resolve(folder, file)));
  if (missing.length > 0) {
    throw new Error(`The theme folder ${themes[mode]} (appearance.themes.${mode}) has no ${missing.join(" or ")}.`);
  }
  return folder;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Builds the browser app into dist/, which the server serves. `pnpm exec vite` serves the app
// for development, and passes the requests of the API and of the health check on to albireo
// on port 8080, such as a container that runs with -p 127.0.0.1:8080:8080.
export default defineConfig({
  plugins: [react(), tailwindcss(), albireoAppearance(APPEARANCE)],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      "/healthz": "http://127.0.0.1:8080",
    },
  },
});
