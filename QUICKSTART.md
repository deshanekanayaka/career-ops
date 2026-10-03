# Quickstart 
— Tharidu's career-ops setup

Your own cheat sheet. Nothing here is generic career-ops documentation; it
reflects the choices already made in this checkout.

## Your setup, in one glance

| Setting | Value | Where |
|---|---|---|
| CV data | `cv.md` | root, gitignored, never edit by hand mid-session — ask the AI to update it |
| Identity/targeting | `config/profile.yml` | root, gitignored |
| Your house rules | `modes/_custom.md` | bullet counts, style rules, banned content |
| Your facts/targeting | `modes/_profile.md` | project selection, exit narrative, comp policy |
| CV render engine | LaTeX (`cv.output_format: latex`) | `config/profile.yml` |
| CV template | `clean` (A4, no photo, visible project links) | `templates/cv-template.clean.tex` |
| AI host | Antigravity CLI (`agy`), free tier | — |
| Evaluation model tier | `standard` | `config/profile.yml` |

## Starting a session

```bash
cd ~/Documents/career-ops
agy
```

The first time in a session, `agy` may ask you to approve loading project
skills/slash commands (the "load of commands" prompt) — that's it discovering
this project's `/career-ops` commands and modes. Say yes; it is not
installing anything external, just letting the CLI read this repo's own
`modes/` files.

## The commands you'll actually use

**Evaluate a job** — paste a URL or the job text directly into the `agy`
chat. It runs the full A-G evaluation, writes a report to `reports/`, and
updates your tracker.

**Generate a tailored CV/PDF for a role** — after evaluating (or on its own):
```
/career-ops pdf
```
This now renders through LaTeX with your `clean` template automatically, no
flag needed.

**Zero-cost sanity check before drafting** (does not touch your daily quota):
```bash
node jd-skill-gap.mjs jds/some-role.txt --summary
```
Save the JD text to that file first; the command classifies it against
`cv.md` into skills you have, skills you can support, and real gaps.

**Scan your saved companies for new postings** (zero tokens):
```bash
node scan.mjs
```

**Check application status:**
```
/career-ops tracker
```

**See what career-ops itself thinks needs attention:**
```bash
npm run doctor
```

## Free-tier quota discipline (Antigravity CLI)

- Roughly 30 full evaluations a day before you likely hit the daily cap.
- `node scan.mjs` and `node generate-pdf.mjs` cost zero tokens — run those
  freely.
- Cap one interactive session at about ten role evaluations, then start a
  fresh `agy` session.
- Full detail: `modes/_custom.md` → "Model routing".

## If something in a generated CV looks wrong

Tell the AI directly, in plain language — "the ClaimLens bullet mentions
MySQL, that's wrong" or "cut the Java project, this role isn't Java." It will
fix `cv.md`, `modes/_profile.md`, or `modes/_custom.md`, whichever actually
owns that fact, not just patch the one output you're looking at.

## Where the full documentation lives

- `AGENTS.md` — the complete rulebook every mode reads.
- `docs/RUNNING_ON_A_BUDGET.md` — cost/quota detail for every AI host.
- `modes/latex.md` — the LaTeX pipeline and the `clean` template's schema.
- `modes/_custom.md` / `modes/_profile.md` — your own house rules and facts,
  in your own words.
