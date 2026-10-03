#!/usr/bin/env node
/**
 * apply-link.mjs — find a posting on the company's own careers portal, else a Google search link.
 *
 * For roles found on LinkedIn: apply on the company site when the posting exists there,
 * otherwise fall back to LinkedIn Easy Apply. Resolution order:
 *   1. portals.yml tracked_companies entry for the company (by name) → its provider
 *   2. discover-ats.mjs resolveCompany() → probes Greenhouse/Ashby/Lever/etc. by slug
 *   3. neither finds a matching title → Google search URL (LinkedIn excluded)
 *
 * Usage:
 *   node apply-link.mjs "<Company>" "<Role>" [--report N] [--json]
 *   node apply-link.mjs --self-test
 *
 * --report N appends an `**Apply via:**` line under the report's `**URL:**` header line.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { loadProviders, resolveProvider } from './providers/_registry.mjs';
import { makeHttpCtx } from './providers/_http.mjs';
import { resolveCompany } from './discover-ats.mjs';
import { roleFuzzyMatch, roleTokens } from './role-matcher.mjs';
import assert from 'node:assert';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();

export function googleUrl(company, role) {
  const q = `"${company}" "${role}" careers apply -site:linkedin.com`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// Fuzzy matches first, then titles containing every role word ("Backend Engineer" ⊂ "Senior Backend Engineer, Payments").
export function matchJobs(jobs, role) {
  const want = roleTokens(role);
  const titled = (jobs || []).filter((j) => j?.title);
  const fuzzy = titled.filter((j) => roleFuzzyMatch(j.title, role));
  const contains = titled.filter((j) => !fuzzy.includes(j) && want.length
    && want.every((t) => roleTokens(j.title).includes(t)));
  return [...fuzzy, ...contains];
}

export function applyLine(result) {
  const [m, ...more] = result.matches;
  if (m) return `**Apply via:** company portal: ${m.url} (${m.title.trim()}${m.location ? `, ${m.location}` : ''})`
    + (more.length ? ` +${more.length} similar, pick by location via --json` : '');
  if (result.careersUrl) return `**Apply via:** not on company board (${result.careersUrl}); LinkedIn Easy Apply, or check ${result.googleUrl}`;
  return `**Apply via:** no company portal found; LinkedIn Easy Apply, or check ${result.googleUrl}`;
}

function portalsEntry(company) {
  const path = process.env.CAREER_OPS_PORTALS || join(DATA_ROOT, 'portals.yml');
  if (!existsSync(path)) return null;
  const doc = yaml.load(readFileSync(path, 'utf8')) || {};
  const want = company.trim().toLowerCase();
  return (doc.tracked_companies || []).find((e) => e?.name?.trim().toLowerCase() === want) || null;
}

export async function findApplyLink(company, role) {
  const ctx = makeHttpCtx();
  const providers = await loadProviders(join(ROOT, 'providers'));
  const result = { company, role, careersUrl: null, matches: [], googleUrl: googleUrl(company, role) };

  let entry = portalsEntry(company);
  if (!entry) {
    const { resolved } = await resolveCompany({ name: company }, { ctx });
    if (resolved) entry = { name: company, careers_url: resolved.careers_url, api: resolved.api };
  }
  if (entry) {
    result.careersUrl = entry.careers_url || null;
    const hit = resolveProvider(entry, providers, { skipIds: ['local-parser'] });
    if (hit?.provider) {
      try {
        result.matches = matchJobs(await hit.provider.fetch(entry, ctx), role)
          .map(({ title, url, location }) => ({ title, url, location }));
      } catch (err) {
        result.error = err?.message || String(err);
      }
    }
  }
  result.applyVia = applyLine(result);
  return result;
}

function appendToReport(num, line) {
  const dir = join(DATA_ROOT, 'reports');
  const n = String(Number(num));
  const file = readdirSync(dir).find((f) => f.endsWith('.md') && String(Number(f.split('-')[0])) === n);
  if (!file) return console.error(`⚠️  no report #${num} in reports/`);
  const path = join(dir, file);
  const text = readFileSync(path, 'utf8');
  if (text.includes('**Apply via:**')) return;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith('**URL:**'));
  lines.splice(i === -1 ? 1 : i + 1, 0, line);
  writeFileSync(path, lines.join('\n'));
}

function selfTest() {
  const jobs = [
    { title: 'Senior Backend Engineer', url: 'https://x/1' },
    { title: 'Product Designer', url: 'https://x/2' },
  ];
  assert.ok(matchJobs(jobs, 'Backend Engineer').length === 1, 'fuzzy match');
  assert.ok(matchJobs(jobs, 'Data Scientist').length === 0, 'no false match');
  const g = googleUrl('Acme', 'Data Engineer');
  assert.ok(g.includes('%22Acme%22') && g.includes('-site%3Alinkedin.com'), 'google url');
  assert.ok(applyLine({ matches: [], careersUrl: null, googleUrl: g }).includes('Easy Apply'), 'fallback line');
  console.log('apply-link self-test ok');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); process.exit(0); }
  const r = args.indexOf('--report');
  const report = r !== -1 ? args[r + 1] : null;
  const [company, role] = args.filter((a, i) => !a.startsWith('--') && (r === -1 || i !== r + 1));
  if (!company || !role) {
    console.error('Usage: node apply-link.mjs "<Company>" "<Role>" [--report N] [--json]');
    process.exit(2);
  }
  const result = await findApplyLink(company, role);
  if (report) appendToReport(report, result.applyVia);
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : result.applyVia);
}
