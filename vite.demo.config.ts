import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { albireoAppearance, APPEARANCE } from "./vite.config.ts";

// The demo on GitHub Pages: the browser app alone, without the server. Build it in the
// "demo" mode, which answers the API from sample data (src/demo/api.ts), with the base of
// the Pages site:
//   pnpm exec vite build --config vite.demo.config.ts --mode demo --base /albireo/
// scripts/demo-media.ts adds the videos and the files.
export default defineConfig({
  plugins: [react(), tailwindcss(), albireoAppearance(APPEARANCE)],
  build: { outDir: "demo-dist", emptyOutDir: true },
});
