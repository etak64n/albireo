// Which viewer previews an attachment, chosen from the extension of its file name.

export type PreviewKind = "pdf" | "slides" | "markdown" | "text" | "image";

const KINDS: Record<string, PreviewKind> = {
  pdf: "pdf",
  pptx: "slides",
  ppt: "slides",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  csv: "text",
  json: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
};

/** The viewer for the file, or null when the file can only be downloaded. */
export function previewKindOf(fileName: string): PreviewKind | null {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase();
  return (extension === undefined ? undefined : KINDS[extension]) ?? null;
}
