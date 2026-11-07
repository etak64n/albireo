// Writes slides as a small PDF for the attachments of the demo: 16:9 pages of boxes and
// lines of text. The text is in Helvetica, which every PDF reader has, so the file needs
// no font of its own, and the whole file is ASCII, so its length in characters is its
// length in bytes, which the table of byte offsets at its end needs.

/** A filled box, from its top left corner, in points of a page of 960 by 540. */
export interface PdfBox {
  box: readonly [x: number, y: number, width: number, height: number];
  color: string;
}

/** A line of text, from the left end of its baseline. */
export interface PdfText {
  text: string;
  at: readonly [x: number, y: number];
  size: number;
  color: string;
  bold?: boolean;
}

export type PdfItem = PdfBox | PdfText;

const PAGE_WIDTH = 960;
const PAGE_HEIGHT = 540;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/** A PDF with one page for each list of items, drawn in order. */
export function slidesPdf(pages: readonly (readonly PdfItem[])[]): string {
  // Objects 1 to 4 are the catalog, the page tree, and the regular and bold Helvetica.
  // Each page follows as two objects: the page, then its drawing.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((items, index) => {
    const drawing = items.map(draw).join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
      `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const table = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${table}\n%%EOF\n`;
  return pdf;
}

// PDF measures from the lower left corner of the page, and the items from the upper left.
function draw(item: PdfItem): string {
  if ("box" in item) {
    const [x, y, width, height] = item.box;
    return `${fill(item.color)} ${x} ${PAGE_HEIGHT - y - height} ${width} ${height} re f`;
  }
  if (!PRINTABLE_ASCII.test(item.text)) throw new Error(`The slides can hold only printable ASCII: ${item.text}`);
  const [x, y] = item.at;
  const text = item.text.replace(/[\\()]/g, (char) => `\\${char}`);
  return `BT /${item.bold === true ? "F2" : "F1"} ${item.size} Tf ${fill(item.color)} ${x} ${PAGE_HEIGHT - y} Td (${text}) Tj ET`;
}

/** The operator that sets the color of filling, from a color such as #1a2c44. */
function fill(color: string): string {
  const channels = [1, 3, 5].map((start) => (Number.parseInt(color.slice(start, start + 2), 16) / 255).toFixed(3));
  return `${channels.join(" ")} rg`;
}
