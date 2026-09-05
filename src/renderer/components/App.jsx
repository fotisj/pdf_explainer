import React, { useState, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { addOrUpdateRecentDocument } from '../../state/slices/pdfSlice';
import LandingPage from './LandingPage';
import PDFViewer from './PDFViewer';
import AIPanel from './AIPanel';
import SettingsConfig from './SettingsConfig';

const App = () => {
  const [pdfPath, setPdfPath] = useState(null);
  const [showLanding, setShowLanding] = useState(true);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [showDocChatPanel, setShowDocChatPanel] = useState(false);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [documentText, setDocumentText] = useState('');
  const pdfViewerRef = useRef(null);
  const dispatch = useDispatch();
  const modelCapabilities = useSelector((state) => state.user.modelCapabilities);
  const visionCapable = modelCapabilities.checked && modelCapabilities.found ? modelCapabilities.supportsImages : true;

  const handleOpenPDF = async (providedPath) => {
    try {
      let filePath = typeof providedPath === 'string' ? providedPath : null;
      if (!filePath) {
        filePath = await window.electron.openFile();
      }
      if (!filePath) return;

      setPdfPath(filePath);
      setShowLanding(false);
      setPendingSelection(null);
      setShowAIPanel(false);
      setShowDocChatPanel(false);

      const fileName = filePath.split(/[/\\]/).pop() || 'Unnamed Document';
      dispatch(addOrUpdateRecentDocument({ path: filePath, name: fileName, lastAccessed: new Date().toISOString() }));
      await window.electron.addRecentDocument(filePath);
    } catch (error) {
      console.error('Error opening PDF:', error);
    }
  };

  const handlePassageMarked = (selection) => {
    setPendingSelection(selection);
    setShowAIPanel(true);
  };

  const handleCloseAIPanel = () => {
    pdfViewerRef.current?.discardPending();
    setPendingSelection(null);
    setShowAIPanel(false);
  };

  const handleSaveNote = async (noteText) => {
    const result = await pdfViewerRef.current?.commitPendingAsNote(noteText);
    if (result?.success) {
      setPendingSelection(null);
      setShowAIPanel(false);
    }
    return result;
  };

  const handleSaveDocumentNote = async (noteText) => {
    const result = await pdfViewerRef.current?.commitDocumentNote(noteText);
    return result;
  };

  const handleBackToLanding = () => {
    setPdfPath(null);
    setPendingSelection(null);
    setShowAIPanel(false);
    setShowDocChatPanel(false);
    setShowLanding(true);
    setDocumentText('');
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f2027', color: 'white', position: 'relative', overflow: 'hidden' }}>
      {showLanding ? (
        <LandingPage onOpenPDF={handleOpenPDF} />
      ) : (
        <>
          <header style={{
            padding: '15px',
            background: 'linear-gradient(90deg, #0f2027, #203a43, #2c5364)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            backdropFilter: 'blur(10px)',
            zIndex: 10,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
          }}>
            <button
              onClick={handleBackToLanding}
              style={{
                background: 'rgba(255, 255, 255, 0.1)', color: 'white', border: 'none', borderRadius: '8px',
                padding: '10px 15px', fontSize: '0.9rem', fontWeight: 500, display: 'flex', alignItems: 'center',
                gap: '8px', cursor: 'pointer',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              Back to Home
            </button>

            <div style={{ margin: '0 15px', color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              {pdfPath ? pdfPath.split(/[/\\]/).pop() : 'No file selected'}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto', gap: '12px' }}>
              <button
                onClick={() => setShowDocChatPanel((v) => !v)}
                style={{
                  background: showDocChatPanel ? 'rgba(79, 140, 181, 0.35)' : 'rgba(255, 255, 255, 0.1)',
                  color: 'white', border: 'none', borderRadius: '8px',
                  padding: '10px 15px', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer',
                }}
              >
                Ask about document
              </button>
              <SettingsConfig />
            </div>
          </header>

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: '#1a2a36' }}>
            <div style={{
              flex: 1, overflow: 'hidden', transition: 'margin-left 0.3s ease, margin-right 0.3s ease',
              marginLeft: showDocChatPanel ? '600px' : '0',
              marginRight: showAIPanel ? '600px' : '0',
            }}>
              <PDFViewer
                ref={pdfViewerRef}
                filePath={pdfPath}
                onPassageMarked={handlePassageMarked}
                onDocumentTextExtracted={setDocumentText}
                visionCapable={visionCapable}
              />
            </div>

            <div style={{
              position: 'fixed', top: '65px', right: 0, bottom: 0, width: '600px',
              transform: showAIPanel ? 'translateX(0)' : 'translateX(100%)',
              transition: 'transform 0.3s ease-in-out',
              background: 'linear-gradient(180deg, rgba(15, 32, 39, 0.98) 0%, rgba(32, 58, 67, 0.98) 100%)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '-5px 0 15px rgba(0, 0, 0, 0.2)',
              overflow: 'auto',
              zIndex: 100,
            }}>
              <AIPanel
                pendingSelection={pendingSelection}
                documentText={documentText}
                documentPath={pdfPath}
                onClose={handleCloseAIPanel}
                onSaveNote={handleSaveNote}
              />
            </div>

            <div style={{
              position: 'fixed', top: '65px', left: 0, bottom: 0, width: '600px',
              transform: showDocChatPanel ? 'translateX(0)' : 'translateX(-100%)',
              transition: 'transform 0.3s ease-in-out',
              background: 'linear-gradient(180deg, rgba(15, 32, 39, 0.98) 0%, rgba(32, 58, 67, 0.98) 100%)',
              borderRight: '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: '5px 0 15px rgba(0, 0, 0, 0.2)',
              overflow: 'auto',
              zIndex: 100,
            }}>
              <AIPanel
                mode="document"
                documentText={documentText}
                documentPath={pdfPath}
                onClose={() => setShowDocChatPanel(false)}
                onSaveNote={handleSaveDocumentNote}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default App;
