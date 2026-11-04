// The look of the library, built by the albireo-appearance plugin in vite.config.ts
// from the appearance settings in albireo.config.ts.
declare module "virtual:albireo-appearance" {
  const appearance: {
    /** The name of the library. */
    siteName: string;
    /** URL of logo.svg of the theme folder. */
    logo: string;
  };
  export default appearance;
}
