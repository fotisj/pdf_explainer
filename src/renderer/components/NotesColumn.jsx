import React, { useEffect, useRef, useState } from 'react';
import MarkdownContent from './MarkdownContent';

const iconButtonStyle = (danger) => ({
  background: 'transparent',
  border: 'none',
  color: danger ? 'rgba(255, 120, 120, 0.85)' : 'rgba(255, 255, 255, 0.7)',
  cursor: 'pointer',
  padding: '2px 4px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const smallButtonStyle = (variant) => ({
  padding: '4px 10px',
  fontSize: '0.75rem',
  fontWeight: 600,
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  color: 'white',
  background: variant === 'danger' ? '#c0392b' : 'rgba(255, 255, 255, 0.12)',
});

const NoteCard = ({ note, active, onHover, onFollowUp, onDelete }) => {
  const cardRef = useRef(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(note.id);
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  };

  const hasNote = Boolean(note.note && note.note.trim());

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => onHover(note.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        padding: '12px 14px',
        marginBottom: '10px',
        borderRadius: '8px',
        background: active ? 'rgba(255, 215, 0, 0.14)' : 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${active ? 'rgba(255, 215, 0, 0.5)' : 'rgba(255, 255, 255, 0.08)'}`,
        color: 'white',
        fontSize: '0.85rem',
        lineHeight: '1.5',
        wordBreak: 'break-word',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px', gap: '6px' }}>
        <div style={{ fontSize: '0.68rem', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1 }}>
          {note.kind === 'region' ? 'Region' : 'Highlight'}{hasNote ? ' note' : ' (no note)'}
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onFollowUp(note); }}
          title={hasNote ? 'Ask a follow-up question and add the answer to this note' : 'Ask the AI about this passage and save the answer here'}
          style={iconButtonStyle(false)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }}
          title="Remove this mark and its note from the PDF"
          style={iconButtonStyle(true)}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
      </div>

      {confirmingDelete ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
          <span style={{ fontSize: '0.8rem', flex: 1 }}>Remove this mark?</span>
          <button onClick={handleDelete} disabled={deleting} style={smallButtonStyle('danger')}>
            {deleting ? 'Removing…' : 'Remove'}
          </button>
          <button onClick={() => setConfirmingDelete(false)} disabled={deleting} style={smallButtonStyle()}>
            Cancel
          </button>
        </div>
      ) : hasNote ? (
        <div className="note-markdown" style={{ overflowX: 'auto' }}>
          <MarkdownContent>{note.note}</MarkdownContent>
        </div>
      ) : (
        <div style={{ fontStyle: 'italic', opacity: 0.55 }}>
          {note.text ? `“${note.text.length > 160 ? note.text.slice(0, 160) + '…' : note.text}”` : 'Marked passage without a note.'}
        </div>
      )}
    </div>
  );
};

// Notes for the current page only, in reading order (top to bottom) — normal block flow, so
// long notes simply push the rest of the column down rather than overlapping one another.
const NotesColumn = ({ notes, activeNoteId, onHoverNote, onFollowUpNote, onDeleteNote }) => {
  const sorted = [...notes].sort((a, b) => (a.rects[0]?.top ?? 0) - (b.rects[0]?.top ?? 0));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        fontSize: '0.8rem',
        fontWeight: 600,
        color: 'rgba(255, 255, 255, 0.8)',
        flexShrink: 0,
      }}>
        Notes on this page{sorted.length ? ` (${sorted.length})` : ''}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {sorted.length === 0 ? (
          <div style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center', marginTop: '30px' }}>
            No saved notes on this page yet.
          </div>
        ) : (
          sorted.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              active={note.id === activeNoteId}
              onHover={onHoverNote}
              onFollowUp={onFollowUpNote}
              onDelete={onDeleteNote}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default NotesColumn;
