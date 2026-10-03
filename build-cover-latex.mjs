#!/usr/bin/env node
// build-cover-latex.mjs — render a cover letter payload to PDF with the CV's
// "clean" LaTeX styling (templates/cover-letter-template.clean.tex).
//
// Usage: node build-cover-latex.mjs <payload.json> <output.pdf>
// Payload: { date, greeting, opening, transition,
//            matches: [{label, text}], closing, signoff?, name }
import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { escapeLatex } from './lib/latex-escape.mjs';

const [payloadPath, outPdf] = process.argv.slice(2);
if (!payloadPath || !outPdf) {
  console.error('Usage: node build-cover-latex.mjs <payload.json> <output.pdf>');
  process.exit(1);
}
const p = JSON.parse(readFileSync(payloadPath, 'utf8'));
for (const k of ['date', 'greeting', 'opening', 'closing', 'name']) {
  if (!p[k]) { console.error(`Missing payload field: ${k}`); process.exit(1); }
}

const body = [
  escapeLatex(p.opening),
  p.transition && escapeLatex(p.transition),
  ...(p.matches || []).map((m) => `\\textbf{${escapeLatex(m.label)}:} ${escapeLatex(m.text)}`),
  escapeLatex(p.closing),
].filter(Boolean).join('\n\n');

const fill = {
  DATE: escapeLatex(p.date),
  GREETING: escapeLatex(p.greeting),
  BODY: body,
  SIGNOFF: escapeLatex(p.signoff || 'Best regards,'),
  NAME: escapeLatex(p.name),
};
const tex = readFileSync(new URL('./templates/cover-letter-template.clean.tex', import.meta.url), 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? '');

const texPath = outPdf.replace(/\.pdf$/, '.tex');
writeFileSync(texPath, tex);
execFileSync('node', [new URL('./generate-latex.mjs', import.meta.url).pathname, texPath, outPdf,
  '--compile-only', '--max-pages=1', '--strict-pages'], { stdio: 'inherit' });
