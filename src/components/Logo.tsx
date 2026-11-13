import appearance from "virtual:albireo-appearance";

/**
 * The logo of the theme that matches the mode of the device. The picture takes no box of
 * its own, so the image lays out as if it stood alone.
 */
export function Logo({ alt, className }: { alt: string; className: string }) {
  return (
    <picture className="contents">
      <source srcSet={appearance.darkLogo} media="(prefers-color-scheme: dark)" />
      <img src={appearance.logo} alt={alt} className={className} />
    </picture>
  );
}
