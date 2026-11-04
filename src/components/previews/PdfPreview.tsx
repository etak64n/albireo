import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Spinner } from "../ui/spinner.tsx";

// pdf.js reads the file in a worker that albireo serves with the page.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const PAGE_MAX_WIDTH = 1000;

/**
 * Every page of a PDF at the width of the preview, drawn by pdf.js. Unlike a PDF in a
 * frame, this shows all the pages on iPhone and iPad too.
 */
export default function PdfPreview({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState("");

  // Pages follow the width of the preview as the window changes size.
  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.min(PAGE_MAX_WIDTH, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className="mx-auto grid max-w-[1032px] justify-items-center gap-4 p-4">
      {error && <p className="error-box w-full">{error}</p>}
      {width > 0 && (
        <Document
          file={url}
          onLoadSuccess={({ numPages }) => setPages(numPages)}
          onLoadError={(err) => setError(`The PDF could not be opened: ${err.message}`)}
          loading={<Spinner />}
          error={<></>}
          className="grid gap-4"
        >
          {Array.from({ length: pages }, (_, index) => (
            <Page key={index} pageNumber={index + 1} width={width} loading={null} className="bg-surface shadow-card" />
          ))}
        </Document>
      )}
    </div>
  );
}
