import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { validateSettings, type AppearanceSettings } from "./config/settings.ts";

const APPEARANCE_MODULE = "virtual:albireo-appearance";
const THEME_FILES = ["theme.css", "logo.svg"];

// Builds the look of the library from the appearance settings. The browser app
// imports virtual:albireo-appearance, which loads theme.css of the theme folder
// and gives the site name and the URL of logo.svg. The demo (vite.demo.config.ts)
// builds its look with it too.
export function albireoAppearance(appearance: AppearanceSettings): Plugin {
  const folder = resolve(appearance.theme);
  const missing = THEME_FILES.filter((file) => !existsSync(resolve(folder, file)));
  if (missing.length > 0) {
    throw new Error(`The theme folder ${appearance.theme} (appearance.theme) has no ${missing.join(" or ")}.`);
  }
  const resolvedId = `\0${APPEARANCE_MODULE}`;
  return {
    name: "albireo-appearance",
    resolveId: (source) => (source === APPEARANCE_MODULE ? resolvedId : undefined),
    load: (id) => {
      if (id !== resolvedId) return undefined;
      return [
        `import ${JSON.stringify(resolve(folder, "theme.css"))};`,
        `import logo from ${JSON.stringify(resolve(folder, "logo.svg"))};`,
        `export default { siteName: ${JSON.stringify(appearance.siteName)}, logo };`,
      ].join("\n");
    },
    transformIndexHtml: (html) => html.replace("<title>albireo</title>", `<title>${escapeHtml(appearance.siteName)}</title>`),
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Reads albireo.config.ts each time the server starts. This file does not import it,
// because Vite would then restart on every change of the settings, on top of the
// restart that the Cloudflare plugin makes for the same change, and two restarts at
// once can leave the dev server waiting for modules forever.
async function readAppearance(): Promise<AppearanceSettings> {
  const url = `${pathToFileURL(resolve("albireo.config.ts")).href}?t=${Date.now()}`;
  const settings: { default: unknown } = await import(url);
  return validateSettings(settings.default).appearance;
}

// The Cloudflare plugin reads cloudflare.config.ts, runs the Worker in the
// Workers runtime during `cf dev`, and builds it with the browser app.
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), albireoAppearance(await readAppearance()), cloudflare()],
}));
