// The look of the library, built by the albireo-appearance plugin in vite.config.ts
// from APPEARANCE: the name of albireo and its light and dark themes.
declare module "virtual:albireo-appearance" {
  const appearance: {
    /** The name of the library. */
    siteName: string;
    /** URL of logo.svg of the light theme. */
    logo: string;
    /** URL of logo.svg of the dark theme, for pages in dark mode. */
    darkLogo: string;
    /** The icon of the browser tab: the light logo, and the dark one while the browser is in dark mode. */
    favicon: string;
  };
  export default appearance;
}
