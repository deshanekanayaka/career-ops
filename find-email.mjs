#!/usr/bin/env node
/**
 * find-email.mjs — name + company domain → best-guess work email, cheapest source first.
 *
 *   node find-email.mjs --name "Jane Doe" --domain acme.com --company Acme \
 *     [--text reports/042-acme-2026-09-30.md] [--pattern first.last] [--api]
 *
 * Order (stops at the first hit):
 *   1. cache    — data/contacts.tsv already has an email for name+company
 *   2. public   — an @domain address that appears in --text (the JD / report)
 *   3. hunter   — Hunter.io email-finder, ONLY with --api and HUNTER_API_KEY set
 *                 (free tier ~25 searches/month, so the caller gates --api on score)
 *   4. pattern  — --pattern if known, else the common formats; always a guess
 * An MX lookup runs first: a domain with no mail server returns nothing.
 *
 * Read-only: never writes contacts.tsv (saving needs the candidate's OK, see contacto),
 * never sends mail, never probes mailboxes over SMTP. Prints JSON.
 */
try { const { config } = await import('dotenv'); config({ quiet: true }); } catch {}

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveMx } from 'node:dns/promises';
import { parseArgs } from 'node:util';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const FORMATS = {
  'first.last': (f, l) => `${f}.${l}`, flast: (f, l) => f[0] + l, first: (f) => f,
  firstlast: (f, l) => f + l, first_last: (f, l) => `${f}_${l}`, 'f.last': (f, l) => `${f[0]}.${l}`,
  firstl: (f, l) => f + l[0], 'last.first': (f, l) => `${l}.${f}`,
};

const clean = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

export function splitName(name) {
  const parts = name.trim().split(/\s+/).map(clean).filter(Boolean);
  return { first: parts[0] || '', last: parts.length > 1 ? parts.at(-1) : '' };
}

export function fromPattern(pattern, { first, last }, domain) {
  if (!FORMATS[pattern] || !first || (pattern !== 'first' && !last)) return null;
  return `${FORMATS[pattern](first, last)}@${domain}`;
}

export function candidates(name, domain, pattern) {
  const n = splitName(name);
  return [...new Set((pattern ? [pattern] : Object.keys(FORMATS)).map((p) => fromPattern(p, n, domain)).filter(Boolean))];
}

export function publicEmails(text, domain) {
  const re = new RegExp(`[a-z0-9._%+-]+@${domain.replace(/\./g, '\\.')}\\b`, 'gi');
  return [...new Set((text.match(re) || []).map((e) => e.toLowerCase()))];
}

export function cachedEmail(tsv, name, company) {
  const key = (s) => s.trim().toLowerCase();
  for (const line of tsv.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (key(c[0] || '') === key(name) && key(c[1] || '') === key(company) && c[5] && c[5] !== '-') return c[5];
  }
  return null;
}

async function hunter(name, domain) {
  const { first, last } = splitName(name);
  const q = new URLSearchParams({ domain, first_name: first, last_name: last, api_key: process.env.HUNTER_API_KEY });
  const res = await fetch(`https://api.hunter.io/v2/email-finder?${q}`);
  if (!res.ok) throw new Error(`hunter HTTP ${res.status}`);
  const { data } = await res.json();
  return data?.email ? { email: data.email, score: data.score, status: data.verification?.status } : null;
}

async function main() {
  const { values: o } = parseArgs({
    options: { name: { type: 'string' }, domain: { type: 'string' }, company: { type: 'string' },
      text: { type: 'string' }, pattern: { type: 'string' }, api: { type: 'boolean' } },
  });
  if (!o.name || !o.domain) {
    console.error('usage: node find-email.mjs --name "First Last" --domain acme.com [--company Acme] [--text file] [--pattern first.last] [--api]');
    process.exit(2);
  }
  const domain = o.domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const out = (r) => { console.log(JSON.stringify({ name: o.name, domain, ...r }, null, 2)); process.exit(0); };
  const manual = `Try Apollo manually: ${o.name} @ ${domain}`;

  const contacts = join(getCareerOpsRoot(), 'data/contacts.tsv');
  const hit = o.company && existsSync(contacts) && cachedEmail(readFileSync(contacts, 'utf8'), o.name, o.company);
  if (hit) out({ email: hit, source: 'cache', confidence: 'saved' });

  const mx = await resolveMx(domain).then((r) => r.length > 0, () => false);
  if (!mx) out({ email: null, source: null, confidence: null, mx, hint: `${domain} has no mail server: wrong domain? ${manual}` });

  const pub = o.text && existsSync(o.text) ? publicEmails(readFileSync(o.text, 'utf8'), domain) : [];
  if (pub.length) out({ email: pub[0], source: 'public', confidence: 'published', mx, others: pub.slice(1) });

  let apiNote;
  if (o.api && process.env.HUNTER_API_KEY) {
    try {
      const h = await hunter(o.name, domain);
      if (h) out({ email: h.email, source: 'hunter', confidence: `score ${h.score}${h.status ? `, ${h.status}` : ''}`, mx });
      apiNote = 'Hunter found nothing';
    } catch (e) { apiNote = e.message; }
  } else if (o.api) apiNote = 'HUNTER_API_KEY not set';

  const list = candidates(o.name, domain, o.pattern);
  out({ email: list[0] || null, source: 'pattern', confidence: o.pattern ? 'guess (known format)' : 'guess', mx,
    candidates: list, ...(apiNote && { apiNote }), hint: manual });
}

if (isMainModule(import.meta.url)) main();
