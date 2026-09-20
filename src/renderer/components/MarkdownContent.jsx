import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

// Keeps markdown output visually consistent with the app's inline-styled, dark theme (there are
// no CSS classes elsewhere to hook into, and the elements react-markdown produces would
// otherwise pick up the browser's default light-mode margins/colors).
const markdownComponents = {
  p: ({ node, ...props }) => <p style={{ margin: '0 0 10px' }} {...props} />,
  h1: ({ node, ...props }) => <h1 style={{ fontSize: '1.1rem', margin: '12px 0 6px', fontWeight: 700 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ fontSize: '1.05rem', margin: '12px 0 6px', fontWeight: 700 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ fontSize: '1rem', margin: '10px 0 6px', fontWeight: 700 }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '4px 0 10px', paddingLeft: '22px' }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '4px 0 10px', paddingLeft: '22px' }} {...props} />,
  li: ({ node, ...props }) => <li style={{ marginBottom: '4px' }} {...props} />,
  a: ({ node, ...props }) => <a target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }} {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote style={{ margin: '6px 0', paddingLeft: '10px', borderLeft: '3px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.75)' }} {...props} />
  ),
  hr: ({ node, ...props }) => <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', margin: '10px 0' }} {...props} />,
  pre: ({ node, ...props }) => <pre style={{ overflowX: 'auto', margin: '6px 0' }} {...props} />,
  code: ({ node, ...props }) => (
    <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.85em', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} {...props} />
  ),
};

// Renders Markdown with LaTeX math (KaTeX). Used for AI answers and for saved notes alike, so a
// note looks the same in the notes column as it did in the chat.
const MarkdownContent = ({ children }) => (
  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
    {children}
  </ReactMarkdown>
);

export default MarkdownContent;
