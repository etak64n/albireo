// The documentation site of albireo, built with Starlight. .github/workflows/pages.yml
// publishes it to GitHub Pages at https://etak64n.github.io/albireo/docs/, beside the
// demo at the root of the site.
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://etak64n.github.io",
  // GitHub Pages serves the site under the name of the repository, and the demo takes its root.
  base: "/albireo/docs",
  integrations: [
    starlight({
      title: "albireo",
      description: "A private video library on Cloudflare Workers.",
      logo: { src: "./src/assets/albireo-icon.svg" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/etak64n/albireo" }],
      editLink: { baseUrl: "https://github.com/etak64n/albireo/edit/main/docs/" },
      // The same groups as the documentation of deneb: getting started, guides, settings,
      // internals, and the project itself.
      sidebar: [
        { label: "Getting started", items: ["getting-started/try-locally", "getting-started/deploy"] },
        {
          label: "Guides",
          items: [
            "guides/people-and-permissions",
            "guides/upload",
            "guides/home-and-lists",
            "guides/search",
            "guides/series",
            "guides/play",
            "guides/ratings-and-comments",
            "guides/attachments",
            "guides/channels",
          ],
        },
        { label: "Settings", items: ["settings/configuration", "settings/themes"] },
        { label: "Internals", items: ["internals/architecture"] },
        { label: "Project", items: ["project/limits", "project/development", "project/releases"] },
      ],
    }),
  ],
});
