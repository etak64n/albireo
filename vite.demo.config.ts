import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { albireoAppearance } from "./vite.config.ts";

// The demo on GitHub Pages: the browser app alone, without the Cloudflare plugin and
// the Worker. Build it in the "demo" mode, which answers the API from sample data
// (src/demo/api.ts), with the base of the Pages site:
//   pnpm exec vite build --config vite.demo.config.ts --mode demo --base /albireo/
// The demo has no albireo.config.ts, so it names its look here: the name and the light
// theme that albireo comes with. scripts/demo-media.ts adds the videos and the files.
export default defineConfig({
  plugins: [react(), tailwindcss(), albireoAppearance({ siteName: "albireo", theme: "./themes/light" })],
  build: { outDir: "demo-dist", emptyOutDir: true },
});
