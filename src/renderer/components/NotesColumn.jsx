import React, { useEffect, useRef } from 'react';

const NoteCard = ({ note, active, onHover }) => {
  const cardRef = useRef(null);

  useEffect(() => {
    if (active) cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

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
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      <div style={{ fontSize: '0.68rem', opacity: 0.5, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {note.kind === 'region' ? 'Region note' : 'Highlight note'}
      </div>
      {note.note}
    </div>
  );
};

// Notes for the current page only, in reading order (top to bottom) — normal block flow, so
// long notes simply push the rest of the column down rather than overlapping one another.
const NotesColumn = ({ notes, activeNoteId, onHoverNote }) => {
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
            <NoteCard key={note.id} note={note} active={note.id === activeNoteId} onHover={onHoverNote} />
          ))
        )}
      </div>
    </div>
  );
};

export default NotesColumn;
