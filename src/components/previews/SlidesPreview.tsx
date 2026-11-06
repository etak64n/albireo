import "@extend-ai/react-pptx/styles.css";
import wasmUrl from "@extend-ai/react-pptx/pptx_wasm_bg.wasm?url";
import { ReactPptxViewer, setWasmSource } from "@extend-ai/react-pptx";
import { Spinner } from "../ui/spinner.tsx";

// The parser is WebAssembly that albireo serves with the page, so no file goes to another site.
setWasmSource(wasmUrl);

// Slides written on Windows name fonts that a Mac lacks. These stand in for Japanese text.
const FALLBACK_FONTS = ["Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic", "Meiryo"];

/** A PowerPoint file, PPTX or the older PPT, slide by slide at the width of the preview. */
export default function SlidesPreview({ url }: { url: string }) {
  return (
    <ReactPptxViewer
      source={url}
      defaultZoom="fit-width"
      height="100%"
      showThumbnails={false}
      viewportStyle={{ background: "var(--theme-surface-subdued)" }}
      fonts={{ fallbackFamilies: FALLBACK_FONTS }}
      renderLoading={() => <Spinner />}
      renderError={(error) => <p className="error-box m-4">The slides could not be opened: {error.message}</p>}
    />
  );
}
