// Notes are stored in the PDF as Markdown with LaTeX math, so they stay portable (any PDF
// reader shows the readable source) while this app renders them with KaTeX. KaTeX via
// remark-math only recognises `$…$` and `$$…$$`, but models also emit `\(…\)` and `\[…\]`,
// so everything is normalised to dollar delimiters before it is saved.
export function normalizeMathDelimiters(text) {
  if (!text) return '';
  return text
    .replace(/\\\[\s*([\s\S]*?)\s*\\\]/g, (_, body) => `$$\n${body}\n$$`)
    .replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, body) => `$${body}$`);
}
