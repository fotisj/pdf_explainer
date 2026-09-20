import React, { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownContent from './MarkdownContent';

const uuid = () => Math.random().toString(36).substr(2, 9);

const defaultPromptFor = (selection) => {
  if (!selection) return '';
  if (selection.kind === 'text') return `Explain this passage:\n\n"${selection.text}"`;
  return 'Explain the marked region of the page — it may be an equation, figure, or table.';
};

const AIPanel = ({ mode = 'passage', pendingSelection, documentText, documentPath, onClose, onSaveNote }) => {
  const isDocumentMode = mode === 'document';
  const [messages, setMessages] = useState([]); // {id, role, content, isError} — display copy
  const [inputMessage, setInputMessage] = useState('');
  const [composerText, setComposerText] = useState(''); // editable prompt for the not-yet-sent mark
  const [awaitingSend, setAwaitingSend] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAbstracting, setIsAbstracting] = useState(false);
  const [abstractDraft, setAbstractDraft] = useState(null); // editable summary text, or null when not reviewing one
  const chatContainerRef = useRef(null);
  const inputRef = useRef(null);
  const composerRef = useRef(null);
  const streamingMessageIdRef = useRef(null);
  const activeStreamIdRef = useRef(null);
  const lastSelectionRef = useRef(null);
  // The turn-0 {text, imageDataUrl} exactly as sent, frozen at send time so follow-up calls can
  // rebuild an identical prefix (see handleSendMessage) for provider-side prompt caching to hit.
  const initialTurnRef = useRef(null);

  const appendOrUpdateAssistant = useCallback((messageId, updater) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;
      const copy = [...prev];
      copy[idx] = updater(copy[idx]);
      return copy;
    });
  }, []);

  const handleConverseChunk = useCallback((chunk) => {
    if (chunk.streamId !== activeStreamIdRef.current) return;
    const messageId = streamingMessageIdRef.current;
    if (!messageId) return;
    if (chunk.type === 'error') {
      appendOrUpdateAssistant(messageId, (m) => ({ ...m, content: `Error: ${chunk.content}`, isError: true }));
      setIsStreaming(false);
      streamingMessageIdRef.current = null;
      activeStreamIdRef.current = null;
    } else if (chunk.type === 'content') {
      appendOrUpdateAssistant(messageId, (m) => ({
        ...m,
        content: m.content === '…' ? chunk.content : m.content + chunk.content,
      }));
    }
  }, [appendOrUpdateAssistant]);

  const handleConverseEnd = useCallback((streamId) => {
    if (streamId !== activeStreamIdRef.current) return;
    setIsStreaming(false);
    streamingMessageIdRef.current = null;
    activeStreamIdRef.current = null;
  }, []);

  useEffect(() => {
    const unsubChunk = window.electron.onConverseChunk(handleConverseChunk);
    const unsubEnd = window.electron.onConverseEnd(handleConverseEnd);
    return () => {
      unsubChunk();
      unsubEnd();
    };
  }, [handleConverseChunk, handleConverseEnd]);

  // A new passage was marked: show an editable prompt instead of sending right away.
  useEffect(() => {
    if (!pendingSelection || pendingSelection === lastSelectionRef.current) return;
    lastSelectionRef.current = pendingSelection;

    setAbstractDraft(null);
    setInputMessage('');

    const existingNote = pendingSelection.existingNote?.note?.trim();
    if (existingNote) {
      // Reopening a saved note: replay the original prompt and the saved explanation as the
      // conversation so far, so a follow-up question has its context and goes straight to input.
      const prompt = defaultPromptFor(pendingSelection);
      initialTurnRef.current = {
        text: prompt,
        imageDataUrl: pendingSelection.kind === 'region' ? pendingSelection.imageDataUrl : undefined,
      };
      setMessages([
        { id: uuid(), role: 'user', content: prompt, seeded: true },
        { id: uuid(), role: 'assistant', content: existingNote, seeded: true },
      ]);
      setComposerText('');
      setAwaitingSend(false);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }

    setMessages([]);
    initialTurnRef.current = null;
    setComposerText(defaultPromptFor(pendingSelection));
    setAwaitingSend(true);
    setTimeout(() => composerRef.current?.focus(), 0);
  }, [pendingSelection]);

  // Sends a message, whether it's turn 0 (passage mode's approved prompt, or document mode's
  // first free-form question) or a follow-up. Each call is stateless, so a follow-up rebuilds
  // the full turn history; turn 0 is replayed byte-identical (see initialTurnRef) so provider-
  // side prompt caching still hits.
  const sendMessage = (rawText) => {
    const text = rawText.trim();
    if (!text || isStreaming) return;

    const userMessage = { id: uuid(), role: 'user', content: text };
    const assistantMessageId = uuid();
    const assistantMessage = { id: assistantMessageId, role: 'assistant', content: '…' };

    let turns;
    if (!initialTurnRef.current) {
      const imageDataUrl = !isDocumentMode && pendingSelection?.kind === 'region' ? pendingSelection.imageDataUrl : undefined;
      initialTurnRef.current = { text, imageDataUrl };
      turns = [{ role: 'user', text, imageDataUrl }];
      setMessages([userMessage, assistantMessage]);
    } else {
      const priorTurns = messages.map((m, idx) =>
        idx === 0 ? { role: 'user', ...initialTurnRef.current } : { role: m.role, text: m.content }
      );
      turns = [...priorTurns, { role: 'user', text }];
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
    }

    const streamId = uuid();
    streamingMessageIdRef.current = assistantMessageId;
    activeStreamIdRef.current = streamId;
    setIsStreaming(true);

    window.electron.aiConverse({ turns, documentText, documentPath }, streamId);
  };

  // Saves the marked passage as a plain highlight without asking the AI anything.
  const handleMarkOnly = async () => {
    setIsSaving(true);
    try {
      const result = await onSaveNote('');
      if (!result?.success) console.error('Failed to save mark:', result?.error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendInitial = () => {
    if (!composerText.trim()) return;
    setAwaitingSend(false);
    sendMessage(composerText);
  };

  const handleComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendInitial();
    }
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = () => {
    if (!inputMessage.trim() || isStreaming) return;
    sendMessage(inputMessage);
    setInputMessage('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSave = async () => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.isError && !m.seeded);
    if (!lastAssistant || !lastAssistant.content || lastAssistant.content === '…') return;
    const idx = messages.indexOf(lastAssistant);
    const question = idx > 0 && messages[idx - 1].role === 'user' ? messages[idx - 1].content : undefined;
    setIsSaving(true);
    try {
      const result = await onSaveNote(lastAssistant.content, { question });
      if (!result?.success) {
        console.error('Failed to save note:', result?.error);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleAbstract = async () => {
    if (!initialTurnRef.current) return;
    const turns = messages.map((m, idx) =>
      idx === 0 ? { role: 'user', ...initialTurnRef.current } : { role: m.role, text: m.content }
    );
    setIsAbstracting(true);
    try {
      const result = await window.electron.aiSummarize({ turns, documentText, documentPath });
      if (result?.success) {
        setAbstractDraft(result.text);
      } else {
        console.error('Failed to generate abstract:', result?.error);
      }
    } finally {
      setIsAbstracting(false);
    }
  };

  const handleSaveAbstract = async () => {
    const text = abstractDraft?.trim();
    if (!text) return;
    setIsSaving(true);
    try {
      const result = await onSaveNote(text, { replace: true });
      if (result?.success) {
        setAbstractDraft(null);
      } else {
        console.error('Failed to save note:', result?.error);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const isContinuingNote = Boolean(pendingSelection?.existingNote);
  const hasSavableAnswer = messages.some((m) => m.role === 'assistant' && m.content && m.content !== '…' && !m.isError && !m.seeded);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: 'rgba(15, 32, 39, 0.95)', backdropFilter: 'blur(10px)' }}>
      <div style={{ padding: '15px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(44, 83, 100, 0.4)' }}>
        <h3 style={{ margin: 0, fontWeight: 600, fontSize: '1.05rem', color: 'white' }}>
          {isDocumentMode ? 'Ask about this document' : isContinuingNote ? 'Continue note' : 'Explain passage'}
        </h3>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', width: '30px', height: '30px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {pendingSelection?.kind === 'region' && pendingSelection.imageDataUrl && (
        <div style={{ padding: '10px 15px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <img src={pendingSelection.imageDataUrl} alt="Marked region" style={{ maxWidth: '100%', maxHeight: '140px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)' }} />
        </div>
      )}

      <div ref={chatContainerRef} style={{ flexGrow: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {awaitingSend ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.8rem' }}>
              Edit the prompt if you like, then send it:
            </div>
            <textarea
              ref={composerRef}
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={6}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '12px 14px',
                color: 'white',
                fontSize: '0.9rem',
                lineHeight: '1.5',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              {!isDocumentMode && !isContinuingNote && (
                <button
                  onClick={handleMarkOnly}
                  disabled={isSaving}
                  title="Save this as a plain mark in the PDF without asking the AI"
                  style={{
                    padding: '9px 18px',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'white',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSaving ? 'Saving…' : 'Mark only'}
                </button>
              )}
              <button
                onClick={handleSendInitial}
                disabled={!composerText.trim() || isSaving}
                style={{
                  padding: '9px 18px',
                  background: composerText.trim() ? 'linear-gradient(135deg, #2c5364, #203a43)' : 'rgba(44, 83, 100, 0.3)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: composerText.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                Explain
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)', fontSize: '0.9rem', padding: '20px', fontStyle: 'italic', flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isDocumentMode
              ? 'Ask a question about the whole document — its full text is included as context.'
              : 'Select text, or use "Mark region" to drag a box over an equation or figure, then click the explain bubble.'}
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} style={{ width: '100%' }}>
              <div style={{ color: message.role === 'user' ? '#4f8cb5' : '#c3e9ff', fontSize: '0.75rem', fontWeight: 500, marginBottom: '4px' }}>
                {message.role === 'user' ? 'You' : 'AI'}
              </div>
              <div style={{
                background: message.role === 'user' ? 'rgba(44, 83, 100, 0.4)' : message.isError ? 'rgba(178, 34, 34, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                padding: '14px 16px',
                borderRadius: '6px',
                color: 'white',
                fontSize: '0.9rem',
                lineHeight: '1.5',
              }}>
                <MarkdownContent>{message.content}</MarkdownContent>
              </div>
            </div>
          ))
        )}
      </div>

      <div style={{ padding: '10px 15px 15px', background: 'rgba(15, 32, 39, 0.95)', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: awaitingSend ? 'none' : 'block' }}>
        {abstractDraft !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '10px' }}>
            <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.8rem' }}>
              {isContinuingNote ? 'Review the abstract; saving it replaces the existing note:' : 'Review the abstract, then save it as the note:'}
            </div>
            <textarea
              value={abstractDraft}
              onChange={(e) => setAbstractDraft(e.target.value)}
              rows={5}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                padding: '12px 14px',
                color: 'white',
                fontSize: '0.9rem',
                lineHeight: '1.5',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setAbstractDraft(null)}
                disabled={isSaving}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: 'white',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                }}
              >
                Discard
              </button>
              <button
                onClick={handleSaveAbstract}
                disabled={isSaving || !abstractDraft.trim()}
                style={{
                  flex: 1,
                  padding: '10px',
                  background: (isSaving || !abstractDraft.trim()) ? 'rgba(34, 197, 94, 0.2)' : '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: (isSaving || !abstractDraft.trim()) ? 'not-allowed' : 'pointer',
                }}
              >
                {isSaving ? 'Saving…' : isContinuingNote ? 'Replace note' : 'Save abstract'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <button
              onClick={handleSave}
              disabled={!hasSavableAnswer || isStreaming || isSaving || isAbstracting}
              style={{
                flex: 1,
                padding: '10px',
                background: (!hasSavableAnswer || isStreaming || isSaving || isAbstracting) ? 'rgba(34, 197, 94, 0.2)' : '#22c55e',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: (!hasSavableAnswer || isStreaming || isSaving || isAbstracting) ? 'not-allowed' : 'pointer',
              }}
            >
              {isSaving ? 'Saving…' : isDocumentMode ? 'Save as note (end of doc)' : isContinuingNote ? 'Add to note' : 'Save as note'}
            </button>
            <button
              onClick={handleAbstract}
              disabled={!hasSavableAnswer || isStreaming || isSaving || isAbstracting}
              title={isContinuingNote ? 'Condense the whole discussion into a short abstract that replaces the saved note' : 'Condense the whole discussion into a short abstract, for review before saving'}
              style={{
                flex: 1,
                padding: '10px',
                background: (!hasSavableAnswer || isStreaming || isSaving || isAbstracting) ? 'rgba(79, 140, 181, 0.2)' : 'linear-gradient(135deg, #2c5364, #203a43)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                cursor: (!hasSavableAnswer || isStreaming || isSaving || isAbstracting) ? 'not-allowed' : 'pointer',
              }}
            >
              {isAbstracting ? 'Summarizing…' : 'Abstract'}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px', background: 'rgba(255, 255, 255, 0.06)', borderRadius: '8px', padding: '12px 14px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <textarea
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isDocumentMode && messages.length === 0 ? 'Ask a question about this document…' : isContinuingNote ? 'Ask a new question about this passage…' : 'Ask a follow-up, or ask the AI to rephrase...'}
            style={{ flex: 1, background: 'transparent', border: 'none', color: 'white', resize: 'none', outline: 'none', fontSize: '0.85rem', lineHeight: '1.4', minHeight: '24px', maxHeight: '100px', fontFamily: 'inherit' }}
            rows={1}
            disabled={isStreaming || (!isDocumentMode && !pendingSelection)}
          />
          <button
            onClick={handleSendMessage}
            disabled={isStreaming || !inputMessage.trim()}
            style={{
              background: (isStreaming || !inputMessage.trim()) ? 'rgba(44, 83, 100, 0.3)' : 'linear-gradient(135deg, #2c5364, #203a43)',
              color: 'white', border: 'none', borderRadius: '6px', width: '34px', height: '34px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: (isStreaming || !inputMessage.trim()) ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
