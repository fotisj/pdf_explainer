// Bundles PDF.js (pdfjs-dist) into the renderer instead of loading it from a CDN, so the app
// works fully offline. The worker is emitted by webpack as a separate asset next to renderer.js.
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Compatibility shim for the pre-v4 `renderTextLayer()` API used by PDFViewer.
function renderTextLayer({ textContent, container, viewport }) {
  const layer = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport });
  return { promise: layer.render(), cancel: () => layer.cancel() };
}

const lib = { ...pdfjsLib, renderTextLayer };
window.pdfjsLib = lib;

export default lib;
