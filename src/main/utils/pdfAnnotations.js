// Reads/writes real PDF Highlight (text) and Square (region) annotations, each with a
// linked Popup carrying the saved AI explanation as its /Contents, using pdf-lib's
// low-level object API since pdf-lib has no high-level markup-annotation helpers.
const fs = require('fs');
const crypto = require('crypto');
const { PDFDocument, PDFName, PDFHexString } = require('pdf-lib');

const HIGHLIGHT_COLOR = [1, 0.92, 0.4]; // pale yellow
const REGION_COLOR = [0.3, 0.6, 1]; // blue border
// Private key holding the marked passage's text so a saved note can later be reopened for
// follow-up questions without re-extracting it from the page.
const PASSAGE_KEY = 'PDFExplainerPassage';

// Converts a top-left-origin rect (CSS px at scale 1 == PDF points) to a bottom-left-origin
// PDF [x1, y1, x2, y2] rect. Does not account for page /Rotate.
function rectToPdfSpace(rect, pageHeight) {
  const x1 = rect.left;
  const x2 = rect.left + rect.width;
  const y1 = pageHeight - (rect.top + rect.height);
  const y2 = pageHeight - rect.top;
  return [x1, y1, x2, y2];
}

function pdfSpaceToRect([x1, y1, x2, y2], pageHeight) {
  return {
    left: x1,
    top: pageHeight - y2,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function unionRect(rects) {
  const x1 = Math.min(...rects.map((r) => r[0]));
  const y1 = Math.min(...rects.map((r) => r[1]));
  const x2 = Math.max(...rects.map((r) => r[2]));
  const y2 = Math.max(...rects.map((r) => r[3]));
  return [x1, y1, x2, y2];
}

async function loadPdf(filePath) {
  const bytes = fs.readFileSync(filePath);
  return PDFDocument.load(bytes, { updateMetadata: false });
}

function addAnnotToPage(page, annotRef) {
  const existing = page.node.Annots();
  if (existing) {
    existing.push(annotRef);
  } else {
    page.node.set(PDFName.of('Annots'), page.doc.context.obj([annotRef]));
  }
}

function makePopup(context, parentRef, rect, contents) {
  const popupDict = context.obj({
    Type: 'Annot',
    Subtype: 'Popup',
    Parent: parentRef,
    Rect: rect,
    Open: false,
  });
  return context.register(popupDict);
}

// Shared by saveAnnotation and saveDocumentNote: builds the Highlight/Square annotation dict
// plus its linked Popup, registers both, and appends the annotation to the given page.
function writeAnnotation(pdfDoc, page, { kind, rects, note, text }) {
  const { height: pageHeight } = page.getSize();
  const context = pdfDoc.context;
  const id = crypto.randomUUID();
  const now = new Date();
  const contentsText = PDFHexString.fromText(note);

  const pdfRects = rects.map((r) => rectToPdfSpace(r, pageHeight));
  const boundingRect = unionRect(pdfRects);

  let annotDict;
  if (kind === 'region') {
    annotDict = context.obj({
      Type: 'Annot',
      Subtype: 'Square',
      Rect: boundingRect,
      C: REGION_COLOR,
      CA: 0.9,
      Contents: contentsText,
      NM: id,
      M: now.toISOString(),
      F: 4,
    });
  } else {
    const quadPoints = [];
    pdfRects.forEach(([x1, y1, x2, y2]) => {
      // Order: top-left, top-right, bottom-left, bottom-right (common convention).
      quadPoints.push(x1, y2, x2, y2, x1, y1, x2, y1);
    });
    annotDict = context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: boundingRect,
      QuadPoints: quadPoints,
      C: HIGHLIGHT_COLOR,
      CA: 0.45,
      Contents: contentsText,
      NM: id,
      M: now.toISOString(),
      F: 4,
    });
  }
  if (text) annotDict.set(PDFName.of(PASSAGE_KEY), PDFHexString.fromText(text));
  const annotRef = context.register(annotDict);

  const popupRect = [boundingRect[2], boundingRect[3], boundingRect[2] + 200, boundingRect[3] + 100];
  const popupRef = makePopup(context, annotRef, popupRect, contentsText);
  annotDict.set(PDFName.of('Popup'), popupRef);

  addAnnotToPage(page, annotRef);

  return id;
}

/**
 * @param {string} filePath
 * @param {object} annotation
 * @param {number} annotation.pageNumber 1-indexed
 * @param {'text'|'region'} annotation.kind
 * @param {{top:number,left:number,width:number,height:number}[]} annotation.rects PDF-point space, top-left origin (one rect per line for 'text', exactly one for 'region')
 * @param {string} annotation.note may be empty for a plain mark without explanation
 * @param {string} [annotation.text] the marked passage's text (for 'text' kind)
 * @returns {Promise<string>} the id assigned to the new annotation
 */
async function saveAnnotation(filePath, { pageNumber, kind, rects, note, text }) {
  const pdfDoc = await loadPdf(filePath);
  const page = pdfDoc.getPage(pageNumber - 1);

  const id = writeAnnotation(pdfDoc, page, { kind, rects, note: note || '', text });

  const savedBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, savedBytes);
  return id;
}

/**
 * Saves a document-wide note (e.g. a whole-document chat abstract) that isn't tied to any
 * marked passage. Stored as a small marker annotation near the bottom of the last page, using
 * the same Square-annotation-plus-Popup representation as a marked region, so it reads back
 * through the existing getAnnotations()/NotesColumn path with no schema changes.
 *
 * @param {string} filePath
 * @param {string} note
 * @returns {Promise<string>} the id assigned to the new annotation
 */
async function saveDocumentNote(filePath, note) {
  const pdfDoc = await loadPdf(filePath);
  const pageIndex = pdfDoc.getPageCount() - 1;
  const page = pdfDoc.getPage(pageIndex);
  const { width: pageWidth, height: pageHeight } = page.getSize();

  const markerWidth = 160;
  const markerHeight = 30;
  const margin = 20;
  const markerRect = {
    left: Math.max(pageWidth - margin - markerWidth, margin),
    top: pageHeight - margin - markerHeight,
    width: markerWidth,
    height: markerHeight,
  };

  const id = writeAnnotation(pdfDoc, page, { kind: 'region', rects: [markerRect], note });

  const savedBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, savedBytes);
  return id;
}

/**
 * @param {string} filePath
 * @returns {Promise<Array<{id:string,pageNumber:number,kind:'text'|'region',rects:object[],note:string}>>}
 */
async function getAnnotations(filePath) {
  const pdfDoc = await loadPdf(filePath);
  const results = [];

  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const annots = page.node.Annots();
    if (!annots) continue;
    const { height: pageHeight } = page.getSize();

    for (let j = 0; j < annots.size(); j++) {
      const ref = annots.get(j);
      const dict = pdfDoc.context.lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;

      const subtype = dict.get(PDFName.of('Subtype'));
      const subtypeName = subtype ? subtype.asString().replace(/^\//, '') : '';
      if (subtypeName !== 'Highlight' && subtypeName !== 'Square') continue;

      const nmObj = dict.get(PDFName.of('NM'));
      const contentsObj = dict.get(PDFName.of('Contents'));
      const passageObj = dict.get(PDFName.of(PASSAGE_KEY));
      const note = contentsObj && typeof contentsObj.decodeText === 'function' ? contentsObj.decodeText() : '';
      const text = passageObj && typeof passageObj.decodeText === 'function' ? passageObj.decodeText() : '';
      const id = nmObj && typeof nmObj.decodeText === 'function' ? nmObj.decodeText() : `${i}-${j}`;

      let rects = [];
      if (subtypeName === 'Highlight') {
        const quadPointsObj = dict.get(PDFName.of('QuadPoints'));
        if (quadPointsObj) {
          const nums = quadPointsObj.asArray().map((n) => n.asNumber());
          for (let k = 0; k + 7 < nums.length; k += 8) {
            // quad = topLeftX, topLeftY, topRightX, topRightY, bottomLeftX, bottomLeftY, bottomRightX, bottomRightY
            const topLeftX = nums[k];
            const topLeftY = nums[k + 1];
            const bottomRightX = nums[k + 6];
            const bottomRightY = nums[k + 7];
            rects.push(pdfSpaceToRect([topLeftX, bottomRightY, bottomRightX, topLeftY], pageHeight));
          }
        }
      } else {
        const rectObj = dict.get(PDFName.of('Rect'));
        if (rectObj) {
          const nums = rectObj.asArray().map((n) => n.asNumber());
          rects.push(pdfSpaceToRect(nums, pageHeight));
        }
      }

      if (rects.length === 0) continue;
      results.push({
        id,
        pageNumber: i + 1,
        kind: subtypeName === 'Highlight' ? 'text' : 'region',
        rects,
        note,
        text,
      });
    }
  }

  return results;
}

// Locates the annotation whose /NM equals id. Returns null if not found.
function findAnnotation(pdfDoc, id) {
  for (let i = 0; i < pdfDoc.getPageCount(); i++) {
    const page = pdfDoc.getPage(i);
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let j = 0; j < annots.size(); j++) {
      const ref = annots.get(j);
      const dict = pdfDoc.context.lookup(ref);
      if (!dict || typeof dict.get !== 'function') continue;
      const nmObj = dict.get(PDFName.of('NM'));
      if (nmObj && typeof nmObj.decodeText === 'function' && nmObj.decodeText() === id) {
        return { page, annots, index: j, ref, dict };
      }
    }
  }
  return null;
}

/**
 * Removes the annotation with the given id (and any Popup that points at it) from the PDF.
 * @param {string} filePath
 * @param {string} id
 */
async function deleteAnnotation(filePath, id) {
  const pdfDoc = await loadPdf(filePath);
  const found = findAnnotation(pdfDoc, id);
  if (!found) throw new Error('Annotation not found');
  const { annots, ref } = found;

  // Walk backwards so removing entries doesn't shift indices we still have to visit.
  for (let j = annots.size() - 1; j >= 0; j--) {
    const entryRef = annots.get(j);
    if (entryRef === ref) {
      annots.remove(j);
      continue;
    }
    const entry = pdfDoc.context.lookup(entryRef);
    if (entry && typeof entry.get === 'function' && entry.get(PDFName.of('Parent')) === ref) {
      annots.remove(j);
      pdfDoc.context.delete(entryRef);
    }
  }
  const popupRef = found.dict.get(PDFName.of('Popup'));
  if (popupRef) pdfDoc.context.delete(popupRef);
  pdfDoc.context.delete(ref);

  const savedBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, savedBytes);
}

/**
 * Replaces the note text of an existing annotation (its /Contents and that of its Popup).
 * @param {string} filePath
 * @param {string} id
 * @param {string} note
 */
async function updateAnnotationNote(filePath, id, note) {
  const pdfDoc = await loadPdf(filePath);
  const found = findAnnotation(pdfDoc, id);
  if (!found) throw new Error('Annotation not found');

  const contentsText = PDFHexString.fromText(note || '');
  found.dict.set(PDFName.of('Contents'), contentsText);
  found.dict.set(PDFName.of('M'), pdfDoc.context.obj(new Date().toISOString()));
  const popupRef = found.dict.get(PDFName.of('Popup'));
  const popup = popupRef ? pdfDoc.context.lookup(popupRef) : null;
  if (popup && typeof popup.set === 'function') popup.set(PDFName.of('Contents'), contentsText);

  const savedBytes = await pdfDoc.save();
  fs.writeFileSync(filePath, savedBytes);
}

module.exports = { saveAnnotation, saveDocumentNote, getAnnotations, deleteAnnotation, updateAnnotationNote };
