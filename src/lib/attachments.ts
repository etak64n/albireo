// Which viewer previews an attachment, chosen from the extension of its file name.

export type PreviewKind = "pdf" | "slides" | "markdown" | "text" | "csv" | "code" | "image";

const KINDS: Record<string, PreviewKind> = {
  pdf: "pdf",
  pptx: "slides",
  ppt: "slides",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  csv: "csv",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
};

// The language of highlight.js for each extension of code, which the code viewer colors.
const CODE_LANGUAGES: Record<string, string> = {
  json: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  diff: "diff",
  patch: "diff",
};

function extensionOf(fileName: string): string | null {
  return /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? null;
}

/** The viewer for the file, or null when the file can only be downloaded. */
export function previewKindOf(fileName: string): PreviewKind | null {
  const extension = extensionOf(fileName);
  if (extension === null) return null;
  if (Object.hasOwn(CODE_LANGUAGES, extension)) return "code";
  return Object.hasOwn(KINDS, extension) ? (KINDS[extension] ?? null) : null;
}

/** The language that colors a code file, or null when the file is no code. */
export function codeLanguageOf(fileName: string): string | null {
  const extension = extensionOf(fileName);
  return extension !== null && Object.hasOwn(CODE_LANGUAGES, extension) ? (CODE_LANGUAGES[extension] ?? null) : null;
}
