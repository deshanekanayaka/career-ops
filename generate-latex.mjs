#!/usr/bin/env node

/**
 * generate-latex.mjs — Validate and compile a generated .tex CV file to PDF
 *
 * Usage:
 *   node generate-latex.mjs <input.tex> [output.pdf]
 *   node generate-latex.mjs <input.tex> [output.pdf] --compile-only
 *   node generate-latex.mjs <input.tex> [output.pdf] [--max-pages=N] [--strict-pages]
 *
 * Default: validates career-ops template structure (from templates/cv-template.tex).
 * --compile-only: skip template validation; compile any user-owned .tex (latex-tex mode).
 * --max-pages=N (default 2): page budget checked after a successful compile,
 *   via the same countRenderedPdfPages()/enforcePageBudget() the HTML path
 *   uses (generate-pdf.mjs). Overflow warns by default; --strict-pages makes
 *   it fail (report.compiled=false, exit 1) instead.
 *
 * Requires: tectonic (preferred) or pdflatex on PATH.
 */

import { readFile, writeFile, stat, copyFile, rm } from 'fs/promises';
import { resolve, basename, dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { isMainModule } from './lib/is-main-module.mjs';
import { countRenderedPdfPages, enforcePageBudget } from './generate-pdf.mjs';

const MIN_SECTIONS = 4;

const REQUIRED_COMMANDS = [
  '\\\\resumeSubheading',
  '\\\\resumeItem',
  '\\\\resumeProjectHeading',
];

// Proper Unicode script test (not a hand-picked codepoint range) so
// supplementary-plane ideographs (CJK Unified Ideographs Extension B and
// later, e.g. U+20000+) are covered, not just the BMP. Needs the `u` flag --
// without it, \p{Script=...} throws, and a bare codepoint-range class only
// ever sees UTF-16 surrogate halves for anything above U+FFFF, never the
// real character.
const CJK_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

// xeCJK (Latin-doc CJK) or ctex (Chinese-doc-class CJK) means the .tex
// already loads a CJK-capable font setup (see templates/cv-template.cjk.tex).
// Matches xeCJK/ctex anywhere in a \usepackage package list (not just as the
// sole argument, e.g. `\usepackage{fontspec,xeCJK}`), and ctex's own document
// classes (`\documentclass{ctexart}` and friends), which auto-configure
// xeCJK/LuaTeX-ja/CJK depending on engine without a separate \usepackage.
const CJK_PACKAGE_RE = /\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(?:xeCJK|ctex)\b[^}]*\}|\\documentclass(?:\[[^\]]*\])?\{ctex(?:art|rep|book)?\}/;

/**
 * Resolve the LaTeX engine available on PATH, preferring tectonic (XeTeX
 * backend, supports CJK via fontspec/xeCJK) over pdflatex (no CJK support).
 * @returns {string|null}
 */
export function resolveLatexEngine() {
  for (const candidate of ['tectonic', 'pdflatex']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'pipe' });
      return candidate;
    } catch { /* not found */ }
  }
  return null;
}

/**
 * @param {string} content
 * @param {boolean} compileOnly
 * @param {string|null} [engine] - resolved LaTeX engine ('tectonic'/'pdflatex'/null); affects CJK handling
 * @returns {{ issues: string[], counts: object }}
 */
export function validateLatexContent(content, compileOnly, engine = null) {
  const issues = [];
  let resumeItemCount = 0;
  let subheadingCount = 0;
  let projectHeadingCount = 0;

  if (!content.includes('\\begin{document}')) {
    issues.push('Missing \\begin{document}');
  }
  if (!content.includes('\\end{document}')) {
    issues.push('Missing \\end{document}');
  }

  if (compileOnly) {
    return {
      issues,
      counts: { resumeItems: 0, subheadings: 0, projectHeadings: 0 },
    };
  }

  const sectionCount = (content.match(/\\section\{/g) || []).length;
  if (sectionCount < MIN_SECTIONS) {
    issues.push(`Expected at least ${MIN_SECTIONS} \\section{} blocks (Education, Work Experience, Projects, Skills — or localized equivalents), found ${sectionCount}`);
  }

  if (CJK_RE.test(content)) {
    const hasCjkPackage = CJK_PACKAGE_RE.test(content);
    if (engine === 'tectonic' && hasCjkPackage) {
      // tectonic's backend is XeTeX, so fontspec/xeCJK (loaded by
      // templates/cv-template.cjk.tex) can render CJK glyphs — no issue.
    } else if (engine === 'tectonic') {
      issues.push('CJK characters detected but no CJK package (xeCJK/ctex) is loaded. Generate from the CJK-aware template instead: `node build-cv-latex.mjs <input.json> <output.tex> --template=cjk` (templates/cv-template.cjk.tex), or use `pdf` mode (HTML to PDF, which renders CJK) for these CVs.');
    } else {
      issues.push('CJK characters detected. This CJK-aware LaTeX path needs a XeTeX-based engine (fontspec/xeCJK) — pdfLaTeX cannot compile it. Install tectonic (brew install tectonic) and regenerate from the CJK-aware template (`--template=cjk`), or use `pdf` mode (HTML to PDF, which renders CJK) for these CVs.');
    }
  }

  for (const cmd of REQUIRED_COMMANDS) {
    if (!new RegExp(cmd).test(content)) {
      issues.push(`Missing command: ${cmd}`);
    }
  }

  const unresolvedMatch = content.match(/\{\{[A-Z_]+\}\}/g);
  if (unresolvedMatch) {
    issues.push(`Unresolved placeholders: ${[...new Set(unresolvedMatch)].join(', ')}`);
  }

  const lines = content.split('\n');
  for (const line of lines) {
    if (/\\resumeItem\{/.test(line)) resumeItemCount++;
    if (/\\resumeSubheading(?!Continue)/.test(line)) subheadingCount++;
    if (/\\resumeProjectHeading/.test(line)) projectHeadingCount++;
  }

  if (!content.includes('\\pdfgentounicode=1')) {
    issues.push('Missing \\pdfgentounicode=1 (ATS compatibility)');
  }

  return {
    issues,
    counts: {
      resumeItems: resumeItemCount,
      subheadings: subheadingCount,
      projectHeadings: projectHeadingCount,
    },
  };
}

/**
 * Page count for a compiled PDF: `pdfinfo` (poppler) first, since it reads
 * the real page tree regardless of how the PDF stores it; the shared
 * Chromium-oriented regex counter as a fallback when poppler is not on PATH.
 *
 * @param {string} pdfPath
 * @returns {Promise<number>}
 */
async function countPdfPages(pdfPath) {
  try {
    const out = execFileSync('pdfinfo', [pdfPath], { stdio: 'pipe' }).toString('utf-8');
    const match = out.match(/^Pages:\s+(\d+)\s*$/m);
    if (match) return Number(match[1]);
  } catch {
    // pdfinfo missing or failed — fall through to the regex parser below.
  }
  return countRenderedPdfPages(await readFile(pdfPath));
}

/**
 * @param {string} absPath
 * @param {string} content
 * @param {string|null} outputPath
 * @param {boolean} compileOnly
 * @param {{maxPages?: number, strictPages?: boolean}} [pageOptions] - same
 *   semantics as generate-pdf.mjs's --max-pages/--strict-pages (default: 2,
 *   warning-only). Checked only after a successful compile.
 * @returns {Promise<object>}
 */
export async function compileLatexFile(absPath, content, outputPath, compileOnly, pageOptions = {}) {
  const { maxPages = 2, strictPages = false } = pageOptions;
  const engine = resolveLatexEngine();
  const { issues, counts } = validateLatexContent(content, compileOnly, engine);
  const fileInfo = await stat(absPath);
  const sizeKB = (fileInfo.size / 1024).toFixed(1);

  const report = {
    file: basename(absPath),
    path: absPath,
    sizeKB: parseFloat(sizeKB),
    counts,
    issues,
    valid: issues.length === 0,
    compileOnly,
  };

  if (issues.length > 0) {
    return report;
  }

  const texDir = dirname(absPath);
  const texBase = basename(absPath, '.tex');
  const defaultPdf = join(texDir, `${texBase}.pdf`);
  const targetPdf = outputPath ? resolve(outputPath) : defaultPdf;

  const targetDir = dirname(targetPdf);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  if (!engine) {
    report.compiled = false;
    report.compileError = 'No LaTeX engine found. Install tectonic (brew install tectonic) or pdflatex.';
    return report;
  }

  report.engine = engine;

  let compilePath = absPath;
  if (engine === 'tectonic') {
    const patched = content
      .replace(/\\pdfgentounicode\s*=\s*\d+[^\n]*\n?/g, '')
      .replace(/\\input\{glyphtounicode\}[^\n]*\n?/g, '');
    compilePath = join(texDir, `${texBase}._tectonic.tex`);
    await writeFile(compilePath, patched, 'utf-8');
  }

  try {
    if (engine === 'tectonic') {
      execFileSync('tectonic', ['--outdir', texDir, compilePath], {
        cwd: texDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
    } else {
      const pdflatexArgs = [
        '-no-shell-escape',
        '-interaction=nonstopmode',
        '-halt-on-error',
        `-output-directory=${texDir}`,
        absPath,
      ];
      execFileSync('pdflatex', pdflatexArgs, { cwd: texDir, stdio: 'pipe', timeout: 120_000 });
      execFileSync('pdflatex', pdflatexArgs, { cwd: texDir, stdio: 'pipe', timeout: 120_000 });
    }

    report.compiled = true;
  } catch (err) {
    const logPath = join(texDir, `${texBase}.log`);
    let latexError = err.message;
    try {
      const log = await readFile(logPath, 'utf-8');
      const errorLines = log.split('\n').filter(l => l.startsWith('!'));
      if (errorLines.length > 0) {
        latexError = errorLines.join('\n');
      }
    } catch { /* no log */ }

    report.compiled = false;
    report.compileError = latexError;
  }

  if (report.compiled) {
    const compileBase = basename(compilePath, '.tex');
    const compiledPdf = join(texDir, `${compileBase}.pdf`);

    try {
      await copyFile(compiledPdf, targetPdf);
      if (resolve(compiledPdf) !== resolve(targetPdf)) {
        await rm(compiledPdf).catch(() => {});
      }

      const pdfStat = await stat(targetPdf);
      report.pdf = {
        path: targetPdf,
        sizeKB: parseFloat((pdfStat.size / 1024).toFixed(1)),
      };

      // Same gate as the HTML/Playwright path (generate-pdf.mjs): warn by
      // default, reject with --strict-pages.
      //
      // Page count itself comes from `pdfinfo` first, not the shared
      // countRenderedPdfPages() regex parser: that parser was written against
      // Chromium's classic, uncompressed object layout and cannot see a
      // catalog packed into a PDF 1.5+ object stream — exactly what
      // xdvipdfmx (tectonic's PDF backend) and pdflatex/hyperref both
      // produce. `pdfinfo` (poppler) reads the real page tree regardless of
      // how it is stored; the regex parser is kept as a fallback for an
      // environment with a LaTeX engine but no poppler.
      report.maxPages = maxPages;
      report.strictPages = strictPages;
      try {
        report.pageCount = await countPdfPages(targetPdf);
        try {
          enforcePageBudget(report.pageCount, { maxPages, strictPages });
        } catch (err) {
          report.pageBudgetError = err.message;
          if (strictPages) {
            report.compiled = false;
          }
        }
      } catch (err) {
        report.pageCountError = err.message;
      }
    } catch (err) {
      report.postCompileError = `Failed to finalize PDF: ${err.message}`;
    }

    const auxExts = ['.aux', '.log', '.out', '.fls', '.fdb_latexmk', '.synctex.gz'];
    for (const ext of auxExts) {
      await rm(join(texDir, `${compileBase}${ext}`)).catch(() => {});
    }
    if (engine === 'tectonic') {
      await rm(compilePath).catch(() => {});
    }
  }

  return report;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const compileOnly = rawArgs.includes('--compile-only');
  const strictPages = rawArgs.includes('--strict-pages');
  let maxPages = 2, maxPagesInput = '2';
  const args = [];
  for (const arg of rawArgs) {
    if (arg === '--compile-only' || arg === '--strict-pages') continue;
    if (arg.startsWith('--max-pages=')) {
      maxPagesInput = arg.slice('--max-pages='.length);
      maxPages = Number(maxPagesInput);
      continue;
    }
    args.push(arg);
  }
  const inputPath = args[0];
  const outputPath = args[1];

  if (!inputPath) {
    console.error('Usage: node generate-latex.mjs <input.tex> [output.pdf] [--compile-only] [--max-pages=N] [--strict-pages]');
    process.exit(1);
  }

  if (!Number.isInteger(maxPages) || maxPages < 1) {
    console.error(`Invalid --max-pages "${maxPagesInput}". Use a positive integer, e.g. --max-pages=1.`);
    process.exit(1);
  }

  const absPath = resolve(inputPath);
  let content;
  try {
    content = await readFile(absPath, 'utf-8');
  } catch (err) {
    console.error(`Error reading ${absPath}: ${err.message}`);
    process.exit(1);
  }

  const report = await compileLatexFile(absPath, content, outputPath || null, compileOnly, { maxPages, strictPages });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.compiled ? 0 : (report.valid ? 1 : 1));
}

if (isMainModule(import.meta.url)) {
  main();
}
