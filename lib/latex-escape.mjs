/**
 * Shared LaTeX escaping for career-ops CV scripts.
 */

/**
 * Escape user text for insertion into LaTeX macro arguments.
 *
 * @param {string} text
 * @param {'text'|'url'} [mode='text']
 * @returns {string}
 */
export function escapeLatex(text, mode = 'text') {
  // Blank out only truly absent/structural values, and coerce scalars — the
  // same rule #2641 applied to escapeHtml, which this function mirrors.
  // `typeof text !== 'string' -> ''` silently dropped NUMBERS: a payload with
  // `year: 2019` or `dates: 2024` (JSON numbers, not strings) rendered an empty
  // \resumeSubheading date field while the section stayed present, so the .tex
  // shipped without employment dates or graduation years — and the builder
  // still reported "valid": true and exited 0.
  if (text === null || text === undefined || typeof text === 'object') return '';
  const value = String(text);
  if (mode === 'url') return value;
  const chars = [...value];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    switch (ch) {
      case '\\': out.push('\\textbackslash{}'); break;
      case '{': case '}': out.push('\\' + ch); break;
      case '^': out.push('\\textasciicircum{}'); break;
      case '~': out.push('\\textasciitilde{}'); break;
      case '_': out.push('\\_'); break;
      case '&': out.push('\\&'); break;
      case '%': out.push('\\%'); break;
      case '$': out.push('\\$'); break;
      case '#': out.push('\\#'); break;
      // With pdflatex's default OT1 encoding these three have no glyph in the
      // text font: < and > print as inverted ¡/¿ and | as an em-dash, so
      // "p99 <100ms" renders "p99 ¡100ms". The text commands are safe in all
      // encodings.
      case '<': out.push('\\textless{}'); break;
      case '>': out.push('\\textgreater{}'); break;
      case '|': out.push('\\textbar{}'); break;
      case '\u00B1': out.push('$\\pm$'); break;
      case '\u2192': out.push('$\\rightarrow$'); break;
      default: out.push(ch);
    }
    // Break an f+{f,i,l} ligature (ff, fi, fl, and so ffi/ffl too) with an
    // empty TeX group. Without this, a text extractor (pdftotext, an ATS
    // parser) reads the ligature glyph the font substituted at layout time —
    // one Unicode codepoint — instead of the two letters actually typed, so
    // "workflow" comes back "workﬂow" and no longer matches "workflow"
    // anywhere it is searched for. \pdfgentounicode=1 (see the .tex
    // templates) fixes this under pdfTeX, but is a silent no-op under
    // XeTeX-based engines — tectonic included, and tectonic is this
    // project's own documented install recommendation (`brew install
    // tectonic`). Verified against the "clean" template: compiling with
    // tectonic and running pdftotext extracted "workflows" as "workﬂows"
    // and "defined" as "deﬁned" with \pdfgentounicode=1 present, and even
    // with microtype's \DisableLigatures (itself pdfTeX-only — it
    // hard-errors under tectonic). An empty group between the letters
    // suppresses ligature formation at the TeX lexer level, before any font
    // or engine choice, so this fix holds under every engine. Text mode
    // only — mode === 'url' already returned above, so a URL's own "fi"/"fl"
    // is never touched.
    if (ch === 'f' && /[fil]/.test(chars[i + 1] || '')) {
      out.push('{}');
    }
  }
  return out.join('');
}

/**
 * Validate and normalize URLs for \\href{} (not LaTeX-escaped).
 *
 * @param {string} url
 * @returns {string}
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  url = url.trim();
  if (!url) return '';
  const allowedSchemes = ['mailto:', 'http:', 'https:'];
  const hasScheme = allowedSchemes.some(s => url.toLowerCase().startsWith(s));
  if (!hasScheme) {
    if (url.includes('@') && !url.includes('/')) {
      url = 'mailto:' + url;
    } else {
      url = 'https://' + url;
    }
  }
  return url.replace(/[{}%$#\\~^]/g, '');
}
