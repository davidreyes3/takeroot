# Working on this repo

**takeroot** — a spaced-repetition language-learning app. Hebrew is the first
language, but nothing structural is Hebrew-specific: the language-dependent
parts are isolated in `packages/core/src/hebrew.ts` and
`packages/core/src/grammar/`.

**The thesis:** research-grade scheduling, a game-like path, and a real
intervention for the words that refuse to stick. The first two exist elsewhere;
the third is the reason this app exists. Serious flashcard tools tag a word you
keep failing and suspend it, which is giving up.

Full design rationale: [`docs/PLAN.md`](docs/PLAN.md). Read it before making
architectural changes — it records *why* things are the way they are, and
several of those decisions look arbitrary until you know the reason.

---

## Commands

```bash
npm run dev            # http://localhost:5173  (port is pinned, see below)
npm test               # 262 tests
npm run test:watch
npm run typecheck      # tsc -b across the workspace
npm run content:check  # validate content/, report what the app had to guess
npm run sim            # what each retention setting costs in daily reviews
npm run build
```

Node 26, npm 11, npm workspaces. Windows — Git Bash is available, but PowerShell
is the primary shell.

---

## Layout

```
packages/core     Pure TypeScript. No React, no Dexie, no DOM. Ever.
  types.ts          domain types; every derived field is Sourced<T>
  hebrew.ts         niqqud, final forms, answer comparison, transliteration
  grammar/inflect.ts adjective agreement + noun plurals
  content/parse.ts  markdown -> lexemes, with provenance
  content/validate-cli.ts   npm run content:check
  scheduler.ts      ts-fsrs wrapper + auto-grading rules
  cards.ts          lexeme -> card family, tier gating
  leech.ts          leech detection + the gym plan
  session.ts        the queue builder
  simulate.ts       learner simulator / load generator

apps/web          React 19 + Vite 6 PWA, local-first
  store.ts          zustand. Coordinates; never decides.
  db.ts             Dexie, backup export/import, SyncAdapter seam
  face.ts           what each card template shows, front and back
  screens/          PathScreen (+ packLessons), SessionScreen
  exercises/        Flashcard, TypeAnswer, Matching, GymRunner
  components/       Word, HebrewKeyboard, AgreementTable, MnemonicBuilder

content/hebrew/   hand-written vocabulary markdown (the source of truth)
docs/PLAN.md      design decisions and rationale
```

**The core/app boundary is enforced by a test**, not a convention:
`architecture.test.ts` fails if `packages/core` ever imports React, Dexie,
zustand, or touches `window` / `document` / `localStorage` / `indexedDB`. That
boundary is what keeps a future Capacitor build a repackaging job rather than a
rewrite. Don't weaken it.

---

## Domain model in one pass

- **Lexeme** — one real word. Written by hand in `content/hebrew/*.md`.
- **Card** — one schedulable prompt, generated from a lexeme × template. Up to
  6 per word, introduced in **tiers** so a new word costs one card today, not
  six (tier 1 = read it; tier 2 = produce/type/cloze; tier 3 = agreement forms).
  A tier unlocks when every lower-tier sibling reaches FSRS Review state.
- **ReviewLog** — append-only. Never mutated, never deleted.
- **Session** — built fresh by `buildSession`. Order is warm-up → gym →
  reviews → new, all capped.

---

## Decisions that look arbitrary but aren't

Changing any of these without reading the reason will quietly break something.

**Drills are not reviews.** Every gym step except the final test is logged with
`countsForScheduling: false`. If massed in-session repetition fed FSRS,
drilling a word eight times in four minutes would inflate its stability
enormously and the scheduler would conclude you'd mastered a word you'll have
lost tomorrow. The gym ends on one *typed production* test, and only that
answer reschedules the card.

**The drill alternates direction.** Each repetition of the target flips between
its Hebrew→English and English→Hebrew cards. The weakness of massed practice is
repeating an *identical* prompt — you read the answer out of short-term memory.
Flipping direction makes each pass a real retrieval. This is why the drill no
longer pads gaps with already-known words: rapid-fire attention is expensive
and should only be spent on words that need it.

**Easy is unavailable on recognition exercises.** A fast correct answer on a
four-option question may be a lucky guess; awarding Easy would badly inflate
the interval. Only production exercises (typing, form drills) can earn it.

**Slow-but-correct is graded Hard.** Retrieval latency is real evidence of weak
memory strength, and it's exactly the signal a self-graded flashcard discards.
"Slow" is 2.5× the learner's rolling median, floored at 6s.

**Word identity ignores niqqud** — it's (consonantal spelling + part of speech
+ optional `key:`). That's what lets you retranslate, add vowel points, or move
a word between files without losing history. The cost is that true minimal
pairs collide: `מוֹרֶה` (male teacher) and `מוֹרָה` (female teacher) are both
`מורה` unpointed. The second entry declares `; key: f`. Do **not** fold niqqud
back into identity — it would break history the day you point a word.

**Generated inflections are unpointed.** The app can reliably turn `קטן` into
`קטנה`, but not into `קְטַנָּה` — correct vowels need real morphology, since stem
vowels reduce (`גָּדוֹל` → `גְּדוֹלָה`) in ways no suffix rule predicts. Anything
authored always beats anything generated.

**Nothing derived is ever presented as authored.** Every derived field carries
`provenance: 'authored' | 'derived' | 'suggested'`. Guessed roots show as
guesses; `npm run content:check` reports the gaps.

**Lessons come from `##` headings**, not fixed-size chunks. Chunking straddled
meaning and left ragged two-word tails that completed instantly. See
`packLessons` in `PathScreen.tsx`: groups under 4 words merge into their
neighbour, over 8 split, leftover tails re-split evenly.

**Path nodes unlock at 60% mastery, not 100%.** Requiring perfection would gate
the whole course behind whichever single word you find impossible — and that
word is what the gym is for.

**New words are withheld above 80 due cards.** The failure mode that kills SRS
habits is opening the app to a 400-card wall, and it's self-inflicted by
introducing new material while already behind.

**Timestamps are epoch milliseconds, never `Date`.** Dates don't survive
IndexedDB round-trips or JSON export cleanly, and shared mutable Dates are a
classic source of "why did this card's due date change".

---

## Traps discovered the hard way

**The dev port is pinned to 5173 with `strictPort`.** All progress lives in
IndexedDB, which is scoped *per origin*. If Vite fell back to 5174 the app
would open on an empty database and look exactly as though everything was lost.
Failing to start is the kinder outcome. Don't remove this.

**`window.localStorage` is undefined in this jsdom build.** `vitest.setup.ts`
polyfills it, installing the methods on `Storage.prototype` so
`vi.spyOn(Storage.prototype, 'getItem')` still works. Browser code should reach
through `window.localStorage`, never bare `localStorage` — Node 18+ ships a
global of that name and it resolves to the wrong store.

**Hebrew text handling has three sharp edges**, all covered by tests in
`hebrew.test.ts`:
- A vav carrying holam is the *vowel* o, not consonant v — otherwise `שָׁלוֹם`
  transliterates as "shalvom".
- Suffix peeling must happen *before* final forms are normalised, because the
  plural suffix `ים` ends in a final mem.
- A final letter reverts to its plain form before a suffix attaches:
  `לבן` → `לבנה`, not `לבןה`.

**Direction is set per element, never on `<html>`.** The interface is English,
the content is Hebrew. Use the `Word` component, which wraps Hebrew in
`<bdi class="he" lang="he" dir="rtl">`. Anything that displays an *answer* must
follow `face.answerIsHebrew` rather than assuming — the gym tests whichever card
is struggling, so a typed answer is sometimes English.

**Exercises must never be able to strand the learner.** The matching grid once
hung forever because completion was signalled from inside a click handler and
compared mismatched counts. Completion is now *derived from state*, so it
re-checks whenever state settles. Keep it that way.

---

## Testing

Tests first — it has repeatedly paid off here, catching the vav bug, the root
peeling order, the minimal-pair collision, and a tail-size bug in my own
lesson-packing fix.

| Layer | Where |
|---|---|
| Unit + property-based (`fast-check`) | `packages/core/**/*.test.ts` |
| Integration (real Dexie via `fake-indexeddb`) | `apps/web/src/app.test.tsx` |
| Component (Testing Library) | `apps/web/src/**/*.test.tsx` |
| Architecture boundary | `packages/core/src/architecture.test.ts` |
| Simulation, memory, performance guards | `packages/core/src/simulate.test.ts` |

Conventions worth keeping:

- Test names state the *rule*, not the mechanism ("never offers two cards of the
  same word as distractors").
- Regressions carry a comment saying what actually went wrong.
- Property tests cover the invariants: intervals monotonic in rating, stability
  never negative, difficulty inside 1–10, due never in the past, nothing NaN,
  text normalisation never throws on arbitrary Unicode.
- Memory and performance are *tested*, not asserted: bounded query results
  (identical session from 6 log rows or 2,000), bounded output (5,000 cards in
  → ≤70 items out), sub-quadratic scaling, no mutation of inputs.
- Don't assert on `issues[0]` positionally — filter by severity.

---

## Content authoring

Source of truth is `content/hebrew/*.md`. Format spec:
[`content/README.md`](content/README.md). Shortest valid entry:

```markdown
## Greetings
- שָׁלוֹם = hello, goodbye, peace
```

`##` headings name lessons *and* set the part of speech when they happen to
name one; otherwise set `pos:` in frontmatter. Aim for 4–8 words per heading.

The seeded vocabulary (74 words) is a pipeline demonstration, **not an
authoritative course** — it was written by an LLM, not a native speaker, and
should be checked before being relied on.

---

## Working preferences

- **Never name competitor products** in code, comments, docs, or commits. Refer
  to "serious flashcard tools" / "gamified language apps" instead. This was an
  explicit request and applies to anything committed or published.
- **Commits are authored with a GitHub noreply address**:
  `David <57577288+davidreyes3@users.noreply.github.com>`, set repo-local. This
  attributes commits to the user's GitHub profile and counts toward their
  contribution graph, while keeping their real email out of a public history.
  Don't replace it with a real address.
- The user reviews claims and will push back on reasoning, not just on bugs —
  and has been right to. Re-examine rather than defend.
- Reports of problems have been accurate and well-diagnosed. Take them
  seriously and reproduce with a failing test before fixing.

---

## Current state

Working: content pipeline with validation, FSRS-6 scheduling, card generation
with tier gating, leech detection, the full gym escalation, session queue, path
screen, three exercises (flashcard / typing with an on-screen Hebrew keyboard /
matching), mnemonic builder with a worked example, local persistence, backup
export and import.

Next, roughly in order:

1. The four spec'd but unbuilt exercises: multiple choice, speed round, cloze,
   form drills. (`GymRunner` currently filters out `speed` steps.)
2. **Confusable words** — link words by shared root, spelling distance and
   sound distance; when two linked words are both struggling, put them in the
   same matching grid. Contrastive practice is what resolves interference.
   Spec'd in `docs/PLAN.md`.
3. Verb conjugation (binyanim) — the big grammar piece.
4. PWA manifest, service worker, push notifications.
5. FSRS parameter optimizer (`fsrs-browser`, WASM) once there's history to
   train on.
6. In-app editing writing back to markdown.
7. Playwright end-to-end and an accessibility pass.

Explicitly tabled: generated mnemonic suggestions ("make one for me"). The
elaboration is where the encoding happens, so a finished mnemonic trades away
most of the benefit. If built, suggestions should appear only after a real
attempt or a long stall, as raw material rather than a finished answer.
