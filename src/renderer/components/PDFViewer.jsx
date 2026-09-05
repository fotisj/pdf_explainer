import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import NotesColumn from './NotesColumn';

const PDFViewer = forwardRef(({ filePath, onPassageMarked, onDocumentTextExtracted, visionCapable }, ref) => {
  const validFilePath = filePath && typeof filePath === 'string' ? filePath : '';
  const [pdfDocument, setPdfDocument] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [initialPageLoaded, setInitialPageLoaded] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [loading, setLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [error, setError] = useState(null);
  const [pageRenderKey, setPageRenderKey] = useState(0);
  const [pageInputValue, setPageInputValue] = useState('');
  const [pageInputError, setPageInputError] = useState('');

  // Annotations already saved into the PDF file (read back via pdf-lib).
  const [savedAnnotations, setSavedAnnotations] = useState([]);
  // The single in-progress, not-yet-saved marked passage. Cleared on discard/save/new selection.
  const [pendingSelection, setPendingSelection] = useState(null);
  const [activeNoteId, setActiveNoteId] = useState(null); // hovered/clicked note, highlighted in both places

  const [regionMode, setRegionMode] = useState(false);
  const [regionDrag, setRegionDrag] = useState(null); // {startX, startY, curX, curY} in canvasWrapper-local px

  const [selectionTooltip, setSelectionTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });

  const [notesColumnWidth, setNotesColumnWidth] = useState(() => {
    const stored = parseInt(window.localStorage?.getItem('pdfReaderNotesColumnWidth'), 10);
    return Number.isFinite(stored) ? stored : 320;
  });
  const notesResizeRef = useRef(null);

  const containerRef = useRef(null);
  const tooltipRef = useRef(null);
  const selectedTextRef = useRef('');
  const pdfContentRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const currentPageRef = useRef(1);
  const totalPagesRef = useRef(0);

  // Load annotations already saved in the PDF whenever the file changes.
  useEffect(() => {
    if (!validFilePath) {
      setSavedAnnotations([]);
      return;
    }
    const load = async () => {
      try {
        const annots = await window.electron.getAnnotations(validFilePath);
        setSavedAnnotations(Array.isArray(annots) ? annots : []);
      } catch (e) {
        console.error('Failed to load PDF annotations', e);
        setSavedAnnotations([]);
      }
    };
    load();
  }, [validFilePath]);

  const reloadAnnotations = async () => {
    if (!validFilePath) return;
    try {
      const annots = await window.electron.getAnnotations(validFilePath);
      setSavedAnnotations(Array.isArray(annots) ? annots : []);
    } catch (e) {
      console.error('Failed to reload PDF annotations', e);
    }
  };

  // Load PDF document when filePath changes
  useEffect(() => {
    setInitialPageLoaded(false);
    setPdfDocument(null);
    setCurrentPage(1);
    setTotalPages(0);
    setScale(1.5);
    setLoading(false);
    setError(null);
    setLoadingStatus('');
    setPageRenderKey((prev) => prev + 1);
    setPendingSelection(null);
    setActiveNoteId(null);
    setSelectionTooltip({ visible: false, text: '', x: 0, y: 0 });
    setPageInputValue('');
    setPageInputError('');

    pdfDocumentRef.current = null;
    currentPageRef.current = 1;
    totalPagesRef.current = 0;

    if (onDocumentTextExtracted) onDocumentTextExtracted('');

    if (!validFilePath) {
      setLoading(false);
      return;
    }

    const loadPdf = async () => {
      setLoading(true);
      setLoadingStatus('Starting PDF load...');

      try {
        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) throw new Error('PDF.js library not found');

        setLoadingStatus('Reading PDF file...');
        const base64Data = await window.electron.readPdfFile(validFilePath);
        if (!base64Data || typeof base64Data !== 'string') throw new Error('Could not read PDF file');

        setLoadingStatus('Processing PDF data...');
        const binaryData = atob(base64Data);
        const bytes = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i++) bytes[i] = binaryData.charCodeAt(i);

        setLoadingStatus('Loading PDF into viewer...');
        const document = await pdfjsLib.getDocument({ data: bytes }).promise;

        setPdfDocument(document);
        setTotalPages(document.numPages);
        pdfDocumentRef.current = document;
        totalPagesRef.current = document.numPages;

        // Full-text extraction runs in the background (not awaited) so it never delays the
        // first page showing; it's used as grounding context for the AI, not for rendering.
        if (onDocumentTextExtracted) {
          (async () => {
            try {
              let fullText = '';
              for (let i = 1; i <= document.numPages; i++) {
                const page = await document.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map((item) => item.str).join(' ') + '\n\n';
              }
              onDocumentTextExtracted(fullText.trim());
            } catch (e) {
              console.error('Failed to extract full document text:', e);
            }
          })();
        }

        if (!initialPageLoaded && validFilePath) {
          try {
            const lastPage = await window.electron.getLastViewedPage(validFilePath);
            if (lastPage && lastPage > 1 && lastPage <= document.numPages) {
              setCurrentPage(lastPage);
              currentPageRef.current = lastPage;
            }
          } catch (e) {
            console.error('Failed to load last viewed page:', e);
          }
          setInitialPageLoaded(true);
        }

        setLoadingStatus('');
        setTimeout(() => pdfContentRef.current?.focus(), 100);
      } catch (err) {
        console.error('Failed to load PDF:', err);
        setError('Failed to load PDF: ' + err.message);
        setLoadingStatus('Error loading PDF');
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [validFilePath]);

  useEffect(() => { pdfDocumentRef.current = pdfDocument; }, [pdfDocument]);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);

  useEffect(() => {
    currentPageRef.current = currentPage;
    if (!validFilePath || !initialPageLoaded) return;
    const timeoutId = setTimeout(() => {
      window.electron.saveLastViewedPage(validFilePath, currentPage).catch((e) => console.error(e));
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [currentPage, validFilePath, initialPageLoaded]);

  // Render current page
  useEffect(() => {
    if (!pdfDocument || !containerRef.current) return;

    const renderCurrentPage = async () => {
      setLoading(true);
      setLoadingStatus(`Rendering page ${currentPage}...`);
      try {
        const pageContainer = containerRef.current;
        pageContainer.innerHTML = '';

        const canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvasWrapper';
        canvasWrapper.style.position = 'relative';

        const canvas = document.createElement('canvas');
        canvasWrapper.appendChild(canvas);
        pageContainer.appendChild(canvasWrapper);

        const page = await pdfDocument.getPage(currentPage);
        const viewport = page.getViewport({ scale });

        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;

        const textContent = await page.getTextContent();
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        textLayerDiv.style.position = 'absolute';
        textLayerDiv.style.top = '0';
        textLayerDiv.style.left = '0';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        canvasWrapper.appendChild(textLayerDiv);

        const renderTextLayer = window.pdfjsLib.renderTextLayer({
          textContent,
          container: textLayerDiv,
          viewport,
        });
        await renderTextLayer.promise;
        textLayerDiv.style.pointerEvents = 'auto';

        setLoadingStatus('');
        setPageRenderKey((prevKey) => prevKey + 1);
      } catch (err) {
        console.error('Error rendering page:', err);
        setError('Error rendering page: ' + err.message);
        setLoadingStatus('Error rendering page');
      } finally {
        setLoading(false);
      }
    };

    renderCurrentPage();
  }, [pdfDocument, currentPage, scale]);

  // Render saved + pending highlight overlays for the current page.
  useEffect(() => {
    const canvasWrapper = containerRef.current?.querySelector('.canvasWrapper');
    if (!canvasWrapper) return;

    canvasWrapper.querySelectorAll('.pdf-annotation-box').forEach((el) => el.remove());

    const drawBox = (rect, { dashed, color, id, note }) => {
      const div = document.createElement('div');
      div.className = 'pdf-annotation-box';
      div.style.position = 'absolute';
      div.style.top = `${rect.top * scale}px`;
      div.style.left = `${rect.left * scale}px`;
      div.style.width = `${rect.width * scale}px`;
      div.style.height = `${rect.height * scale}px`;
      div.style.borderRadius = '0.2em';
      div.style.zIndex = '3';
      if (dashed) {
        div.style.border = `2px dashed ${color}`;
        div.style.background = `${color}22`;
        div.style.pointerEvents = 'none';
      } else {
        const active = id === activeNoteId;
        div.style.backgroundColor = active ? 'rgba(255, 215, 0, 0.45)' : color;
        div.style.mixBlendMode = 'multiply';
        div.style.cursor = 'pointer';
        div.style.pointerEvents = 'auto';
        if (active) div.style.outline = '2px solid #ffd700';
        div.setAttribute('data-annotation-id', id);
        div.title = note ? note.slice(0, 120) : '';
        div.onclick = (e) => {
          e.stopPropagation();
          setActiveNoteId(id);
        };
      }
      canvasWrapper.appendChild(div);
    };

    savedAnnotations
      .filter((a) => a.pageNumber === currentPage)
      .forEach((a) => a.rects.forEach((rect) => drawBox(rect, { dashed: false, color: 'rgba(135, 206, 235, 0.35)', id: a.id, note: a.note })));

    if (pendingSelection && pendingSelection.pageNumber === currentPage) {
      pendingSelection.rects.forEach((rect) => drawBox(rect, { dashed: true, color: '#4da3ff' }));
    }
  }, [savedAnnotations, pendingSelection, currentPage, scale, pageRenderKey, activeNoteId]);

  // Text selection handling (prose only; bails if selection isn't inside the PDF text layer).
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selectedText = selection.toString().replace(/\s+/g, ' ').trim();
      if (!selectedText) return;

      selectedTextRef.current = selectedText;
      setSelectionTooltip({ visible: false });

      setTimeout(() => {
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rects = range.getClientRects();
          if (rects.length > 0) {
            const firstRect = rects[0];
            setSelectionTooltip({
              visible: true,
              text: selectedText,
              x: firstRect.left + firstRect.width / 2,
              y: firstRect.top - 56,
            });
          }
        }
      }, 10);
    };

    const handleMouseUp = () => {
      if (regionMode) return;
      const selection = window.getSelection();
      if (!selection.toString().trim()) return;

      if (selection.rangeCount > 0) {
        let node = selection.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
        if (!node.closest('.textLayer')) return;
      }
      handleSelectionChange();
    };

    const handleDocumentClick = (e) => {
      if (tooltipRef.current && tooltipRef.current.contains(e.target)) return;
      setActiveNoteId(null);
      setTimeout(() => {
        if (!window.getSelection().toString().trim()) {
          setSelectionTooltip((prev) => ({ ...prev, visible: false }));
        }
      }, 100);
    };

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [regionMode]);

  const handleAskAIForTextSelection = () => {
    const selection = window.getSelection();
    const text = (selectedTextRef.current || selectionTooltip.text || '').trim();
    if (!text || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const clientRects = Array.from(range.getClientRects());
    const canvasWrapper = containerRef.current.querySelector('.canvasWrapper');
    if (!canvasWrapper || clientRects.length === 0) {
      setSelectionTooltip({ visible: false });
      return;
    }

    const canvasWrapperRect = canvasWrapper.getBoundingClientRect();
    const rectsOnPage = clientRects.map((rect) => ({
      top: (rect.top - canvasWrapperRect.top) / scale,
      left: (rect.left - canvasWrapperRect.left) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    }));

    setPendingSelection({ kind: 'text', pageNumber: currentPage, rects: rectsOnPage, text });
    setSelectionTooltip({ visible: false });
    window.getSelection().removeAllRanges();

    if (onPassageMarked) onPassageMarked({ kind: 'text', text });
  };

  // --- Region (image) selection: drag a rectangle over the rendered page ---
  const getCanvasWrapper = () => containerRef.current?.querySelector('.canvasWrapper');

  const handleRegionMouseDown = (e) => {
    if (!regionMode) return;
    const canvasWrapper = getCanvasWrapper();
    if (!canvasWrapper) return;
    const rect = canvasWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setRegionDrag({ startX: x, startY: y, curX: x, curY: y });
  };

  const handleRegionMouseMove = (e) => {
    if (!regionMode || !regionDrag) return;
    const canvasWrapper = getCanvasWrapper();
    if (!canvasWrapper) return;
    const rect = canvasWrapper.getBoundingClientRect();
    setRegionDrag((prev) => ({ ...prev, curX: e.clientX - rect.left, curY: e.clientY - rect.top }));
  };

  const handleRegionMouseUp = () => {
    if (!regionMode || !regionDrag) return;
    const { startX, startY, curX, curY } = regionDrag;
    const left = Math.min(startX, curX);
    const top = Math.min(startY, curY);
    const width = Math.abs(curX - startX);
    const height = Math.abs(curY - startY);
    setRegionDrag(null);

    if (width < 8 || height < 8) return; // too small, ignore accidental clicks

    const canvasWrapper = getCanvasWrapper();
    const canvas = canvasWrapper?.querySelector('canvas');
    if (!canvas) return;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = width;
    cropCanvas.height = height;
    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(canvas, left, top, width, height, 0, 0, width, height);
    const imageDataUrl = cropCanvas.toDataURL('image/png');

    const rectOnPage = { top: top / scale, left: left / scale, width: width / scale, height: height / scale };
    setPendingSelection({ kind: 'region', pageNumber: currentPage, rects: [rectOnPage], imageDataUrl });
    setRegionMode(false);

    if (onPassageMarked) onPassageMarked({ kind: 'region', imageDataUrl });
  };

  const goToPreviousPage = () => currentPage > 1 && setCurrentPage((p) => p - 1);
  const goToNextPage = () => currentPage < totalPages && setCurrentPage((p) => p + 1);
  const zoomIn = () => setScale((s) => s + 0.2);
  const zoomOut = () => setScale((s) => (s > 0.5 ? s - 0.2 : s));

  const goToPage = () => {
    const pageNumber = parseInt(pageInputValue, 10);
    if (isNaN(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
      setPageInputError(`Page ${pageInputValue} doesn't exist. Valid range: 1-${totalPages}`);
      setTimeout(() => setPageInputError(''), 3000);
      return;
    }
    setCurrentPage(pageNumber);
    setPageInputValue('');
    setPageInputError('');
  };

  useImperativeHandle(ref, () => ({
    discardPending: () => setPendingSelection(null),
    commitPendingAsNote: async (noteText) => {
      if (!pendingSelection || !validFilePath) return { success: false, error: 'Nothing to save' };
      const result = await window.electron.saveAnnotation(validFilePath, {
        pageNumber: pendingSelection.pageNumber,
        kind: pendingSelection.kind,
        rects: pendingSelection.rects,
        note: noteText,
      });
      if (result.success) {
        setPendingSelection(null);
        await reloadAnnotations();
      }
      return result;
    },
    commitDocumentNote: async (noteText) => {
      if (!validFilePath) return { success: false, error: 'No document open' };
      const result = await window.electron.saveDocumentNote(validFilePath, noteText);
      if (result.success) {
        await reloadAnnotations();
      }
      return result;
    },
  }));

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      if (!pdfDocumentRef.current || totalPagesRef.current === 0) return;
      if (!pdfContentRef.current || !document.contains(pdfContentRef.current)) return;

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
        case 'PageUp':
          event.preventDefault();
          if (currentPageRef.current > 1) setCurrentPage(currentPageRef.current - 1);
          break;
        case 'ArrowRight':
        case 'ArrowUp':
        case 'PageDown':
          event.preventDefault();
          if (currentPageRef.current < totalPagesRef.current) setCurrentPage(currentPageRef.current + 1);
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (pdfDocument && pdfContentRef.current) {
      setTimeout(() => pdfContentRef.current?.focus(), 100);
    }
  }, [pdfDocument]);

  // Notes-column resize handle
  const handleNotesResizeMouseDown = (e) => {
    notesResizeRef.current = { startX: e.clientX, startWidth: notesColumnWidth };
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', handleNotesResizeMouseMove);
    document.addEventListener('mouseup', handleNotesResizeMouseUp);
  };
  const handleNotesResizeMouseMove = (e) => {
    if (!notesResizeRef.current) return;
    const delta = notesResizeRef.current.startX - e.clientX; // dragging left (toward page) widens the column
    const next = Math.min(800, Math.max(220, notesResizeRef.current.startWidth + delta));
    setNotesColumnWidth(next);
  };
  const handleNotesResizeMouseUp = () => {
    notesResizeRef.current = null;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', handleNotesResizeMouseMove);
    document.removeEventListener('mouseup', handleNotesResizeMouseUp);
  };
  useEffect(() => () => {
    document.removeEventListener('mousemove', handleNotesResizeMouseMove);
    document.removeEventListener('mouseup', handleNotesResizeMouseUp);
    document.body.style.cursor = '';
  }, []);
  useEffect(() => {
    window.localStorage?.setItem('pdfReaderNotesColumnWidth', String(notesColumnWidth));
  }, [notesColumnWidth]);

  const buttonStyle = (active) => ({
    padding: '8px 12px',
    cursor: 'pointer',
    background: active ? 'rgba(77, 163, 255, 0.4)' : 'rgba(255, 255, 255, 0.1)',
    border: active ? '1px solid #4da3ff' : 'none',
    borderRadius: '8px',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const notesForCurrentPage = savedAnnotations.filter((a) => a.pageNumber === currentPage);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '10px 15px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        gap: '10px',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(10px)',
      }}>
        <button onClick={goToPreviousPage} disabled={currentPage <= 1 || loading} style={buttonStyle(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 15px', color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.9rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', minWidth: '80px' }}>
          {currentPage} / {totalPages || '?'}
        </div>

        <button onClick={goToNextPage} disabled={currentPage >= totalPages || loading} style={buttonStyle(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          <input
            type="number"
            value={pageInputValue}
            onChange={(e) => setPageInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && goToPage()}
            placeholder="Page"
            style={{ width: '70px', padding: '8px 10px', background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px', color: 'white', fontSize: '0.9rem', textAlign: 'center', outline: 'none' }}
            disabled={loading || !totalPages}
          />
          <button onClick={goToPage} disabled={loading || !totalPages || !pageInputValue} style={buttonStyle(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="7" y1="17" x2="17" y2="7"></line>
              <polyline points="7 7 17 7 17 17"></polyline>
            </svg>
          </button>
          {pageInputError && (
            <div style={{ position: 'absolute', top: '50%', left: '100%', marginLeft: '10px', transform: 'translateY(-50%)', padding: '8px 12px', background: 'rgba(178, 34, 34, 0.9)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '8px', color: 'white', fontSize: '0.8rem', whiteSpace: 'nowrap', zIndex: 1000 }}>
              {pageInputError}
            </div>
          )}
        </div>

        <button
          onClick={() => visionCapable !== false && setRegionMode((v) => !v)}
          disabled={visionCapable === false}
          title={
            visionCapable === false
              ? "The selected model doesn't support images — pick a vision-capable model in Settings to mark equations/figures"
              : 'Drag a rectangle over an equation, figure, or table to mark it'
          }
          style={{ ...buttonStyle(regionMode), opacity: visionCapable === false ? 0.4 : 1, cursor: visionCapable === false ? 'not-allowed' : 'pointer' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="4 3"></rect>
          </svg>
          <span style={{ marginLeft: '6px', fontSize: '0.8rem' }}>{regionMode ? 'Drag to mark region...' : 'Mark region'}</span>
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={zoomOut} style={buttonStyle(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
          </button>
          <div style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '0.9rem', minWidth: '50px', textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </div>
          <button onClick={zoomIn} style={buttonStyle(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      {loadingStatus && (
        <div style={{ padding: '8px 15px', backgroundColor: 'rgba(44, 83, 100, 0.5)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '16px', height: '16px', borderRadius: '50%', borderTop: '2px solid rgba(255, 255, 255, 0.8)', borderRight: '2px solid transparent', animation: 'spin 1s linear infinite' }}></div>
          {loadingStatus}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div
        ref={pdfContentRef}
        tabIndex={0}
        onMouseDown={handleRegionMouseDown}
        onMouseMove={handleRegionMouseMove}
        onMouseUp={handleRegionMouseUp}
        style={{ flex: 1, overflow: 'auto', backgroundColor: '#0c1821', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '20px', position: 'relative', outline: 'none', cursor: regionMode ? 'crosshair' : 'default' }}
      >
        {loading && !pdfDocument ? (
          <div style={{ padding: '30px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '50%', borderTop: '3px solid white', borderRight: '3px solid transparent', animation: 'spin 1s linear infinite' }}></div>
            <div>{loadingStatus || 'Loading...'}</div>
          </div>
        ) : error ? (
          <div style={{ padding: '30px', backgroundColor: 'rgba(178, 34, 34, 0.1)', borderRadius: '12px', color: 'white', maxWidth: '500px' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#ff6b6b' }}>Error Loading PDF</h3>
            <p style={{ margin: 0 }}>{error}</p>
          </div>
        ) : (
          <div ref={containerRef} style={{ backgroundColor: 'white', boxShadow: '0 4px 30px rgba(0, 0, 0, 0.3)', borderRadius: '8px', overflow: 'hidden', position: 'relative' }}></div>
        )}

        {regionDrag && (
          <div style={{
            position: 'absolute',
            border: '2px dashed #4da3ff',
            background: 'rgba(77, 163, 255, 0.15)',
            left: Math.min(regionDrag.startX, regionDrag.curX) + (containerRef.current?.offsetLeft || 0),
            top: Math.min(regionDrag.startY, regionDrag.curY) + (containerRef.current?.offsetTop || 0),
            width: Math.abs(regionDrag.curX - regionDrag.startX),
            height: Math.abs(regionDrag.curY - regionDrag.startY),
            pointerEvents: 'none',
            zIndex: 5,
          }} />
        )}

        {selectionTooltip.visible && (
          <div
            ref={tooltipRef}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', left: selectionTooltip.x, top: selectionTooltip.y, width: '44px', height: '44px',
              backgroundColor: 'rgba(42, 49, 65, 0.95)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: '50%',
              boxShadow: '0 6px 25px rgba(0, 0, 0, 0.3)', color: 'white', zIndex: 9999, transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', pointerEvents: 'auto',
            }}
          >
            <button
              style={{ width: '100%', height: '100%', background: 'transparent', border: 'none', borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
              onClick={(e) => { e.stopPropagation(); handleAskAIForTextSelection(); }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
          </div>
        )}

      </div>

      <div
        onMouseDown={handleNotesResizeMouseDown}
        style={{ width: '6px', flexShrink: 0, cursor: 'col-resize', background: 'rgba(255, 255, 255, 0.06)' }}
        title="Drag to resize the notes column"
      />

      <div style={{ width: `${notesColumnWidth}px`, flexShrink: 0, background: 'rgba(255, 255, 255, 0.03)', borderLeft: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <NotesColumn notes={notesForCurrentPage} activeNoteId={activeNoteId} onHoverNote={setActiveNoteId} />
      </div>
      </div>
    </div>
  );
});

export default PDFViewer;
