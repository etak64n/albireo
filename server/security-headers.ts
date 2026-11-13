// Security headers of the pages of the browser app and of the files that albireo serves.
//
// The Content-Security-Policy names what a page may load and where its scripts may connect.
// The browser reads every video, picture, and attachment from albireo itself, and sends
// every upload there, so the policy allows nothing outside the origin of albireo.

/** Headers that every page of the browser app carries. */
export function pageHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": PAGE_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * Headers of the files from the bucket. A file opened on its own runs no script and loads
 * nothing but itself: the sandbox puts it in an origin of its own. Inside a page, the policy
 * of the page applies, and these headers change nothing.
 */
export function fileHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": FILE_POLICY,
    "X-Content-Type-Options": "nosniff",
  };
}

const PAGE_POLICY = [
  ["default-src", "'self'"],
  // 'wasm-unsafe-eval' lets the preview of slides run its WebAssembly.
  ["script-src", "'self'", "'wasm-unsafe-eval'"],
  // The components and the player add style elements and style attributes.
  ["style-src", "'self'", "'unsafe-inline'"],
  // blob: and data: are pictures and videos that the browser makes from a chosen file.
  ["img-src", "'self'", "data:", "blob:"],
  ["media-src", "'self'", "blob:"],
  ["connect-src", "'self'"],
  ["font-src", "'self'", "data:"],
  ["worker-src", "'self'", "blob:"],
  ["object-src", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["frame-ancestors", "'none'"],
].map((directive) => directive.join(" ")).join("; ");

// The browser shows a picture or plays a video that is opened on its own in a page that it
// makes, which needs the file itself and inline styles.
const FILE_POLICY = [
  ["default-src", "'none'"],
  ["img-src", "'self'"],
  ["media-src", "'self'"],
  ["style-src", "'unsafe-inline'"],
  ["sandbox"],
].map((directive) => directive.join(" ")).join("; ");
