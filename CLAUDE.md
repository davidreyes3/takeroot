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
npm test               # 327 tests
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
  screens/          PathScreen (+ packLessons, LessonPath, buildPath),
                    ExtrasScreen, WordListManager, SessionScreen, SettingsScreen
  customWords.ts    words/lessons added in-app; merged into Lexeme[] at init
  exercises/        Flashcard, TypeAnswer, Matching, GymRunner
  components/       Word, HebrewKeyboard, AgreementTable, MnemonicBuilder

content/hebrew/   the user's vocabulary, as markdown tables (source of truth)
docs/PLAN.md      design decisions and rationale
docs/source-vocabulary.md   their original pasted list, archived unparsed
.github/workflows/deploy.yml   builds and publishes to GitHub Pages
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
  reviews → new, all capped, and the whole thing capped again by `maxItems`.
  A session can be narrowed to a set of words (one lesson, for practice) or a
  set of templates (typing only, for writing practice).

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

**One session cap sits above the per-stage caps.** `maxReviews`, `maxNew` and
`maxGym` bound each queue separately, which still adds up to a sitting long
enough that you stop opening the app. `maxItems` (default 12, settable) is the
number that decides how long a session actually is. It budgets the new words
*first* and gives the earlier stages what is left — applied as a plain running
total, a steady backlog eats every slot and you never meet another new word.
What does not fit is not skipped: it stays due, and `stats.dueRemaining` says
how much.

**Typing is a setting, off by default, not a deleted feature.** Reading is the
current goal; spelling from memory is a different skill, and mixing it in paces
every session by the harder one. The cards and their history stay either way —
Extras → Writing practice studies them on demand. Two distinct notions in
`buildSession` make this work, and confusing them breaks something quietly:
`templates` narrows what a session may *ask* (writing practice), while
`disabledTemplates` marks templates that will never be studied at all. Only the
latter is hidden from tier gating. Get it backwards and either the tier-3
agreement cards lock away forever behind a `type_he` card that can never
graduate, or writing practice asks you to spell words you cannot yet read.

**The gym closes on a self-graded recall when typing is off.** It has to close
on *something* that reschedules, or a leech never graduates. And that something
must be the target card itself, never a sibling: the card is in the gym because
*its* `againStreak` and lapses flagged it, and only answering that card resets
them. Grading a sibling leaves the word flagged and drags it back in forever.

**Tapping a path node answers count for scheduling, and stay inside that
lesson.** There used to be a separate Practice tab, a flat browser of every
word logging everything with `countsForScheduling: false` — that threw away
the strongest evidence the scheduler could have, and got folded into the path
once the path itself stopped locking anything (see the path-unlocking
decision above). What keeps counting from becoming a hundred surprise reviews
is not the flag, it is the scope: `startSession({ lexemeIds })` sees only the
tapped lesson's words, still takes at most one card per word, and is still
capped by the session length, so a six-word lesson can add at most six cards.

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

**Every path node is open — this reverses an earlier decision.** Nodes used to
unlock only once the one before hit 60% mastery, on the reasoning that
requiring perfection would gate the whole course behind whichever single word
you find impossible. That was true, but the fix cost something else: no way
to jump to a specific lesson on purpose, ahead of or behind where mastery
happened to be. Tapping a node now always starts a session scoped to that
lesson (`startSession({ lexemeIds })`), whether or not it's "next" — see
`PathScreen.tsx`. The mastery ring is still there; it just no longer gates.

**Removing a word or a lesson hides it, it never deletes it.** Settings keeps
an `excludedLexemeIds` set (`db.ts`/`store.ts`); the path, sessions and Extras
all filter through `visibleLexemes()` before anything else touches the list.
Nothing about the word changes — its cards and history are untouched, and
unchecking it in the word list brings it straight back. This has to be true
for markdown-authored words, since the app cannot write back to those files;
kept true for added words too, so "remove" means one thing everywhere.

**Words and lessons added from inside the app are a runtime overlay, not a
markdown edit.** `customWords.ts` + a `customWords` Dexie table hold them; they
merge into the same `Lexeme[]` every other word lives in at `init()`, so
nothing downstream needs to know a word didn't come from a file. This is a
different, smaller thing than "in-app editing that writes back to markdown"
(still on the roadmap below) — a custom word never touches `content/hebrew/`,
never appears in `docs/source-vocabulary.md`, and `npm run content:check`
doesn't see it. All custom lexemes land in one synthetic unit, one past
whatever the authored content uses, recomputed on every load. Ordering them by
plain creation time would let an unrelated lesson's word land between two
words of an earlier lesson and split it on the path — `orderCustomWords`
groups by first-appearance instead, so a lesson stays one lesson no matter
what order you add to it in.

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
- שלום = hello, goodbye, peace
```

Markdown **tables** work too, and are what the real content uses — headers map
onto the same fields (`Hebrew`, `Pronunciation`, `English`, plus optional
`Pos`, `Key`, `FS`/`MP`/`FP`, `Group`, `Note`). Unrecognised columns are
ignored, so an index column costs nothing.

`##` headings name lessons *and* set the part of speech when they happen to
name one; otherwise set `pos:` in frontmatter. Aim for 4–8 words per heading.

The vocabulary is **the user's own course list** (204 words), supplied as a
markdown table. Hebrew, pronunciation and English are exactly as they gave
them; the part-of-speech and lesson groupings were added mechanically and are
the parts worth doubting. The original table is archived unparsed at
`docs/source-vocabulary.md`.

Nothing here carries niqqud, deliberately: an earlier seeded set had niqqud
generated by an LLM, and since transliterations are derived *from* niqqud, an
invented vowel produced a confidently wrong pronunciation. Real
transliterations from the user's course are better evidence. Do not add niqqud
unless it comes from a source the user trusts.

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

## Where it lives

| | |
|---|---|
| Repository | https://github.com/davidreyes3/takeroot (public, MIT, branch `main`) |
| Live app | https://davidreyes3.github.io/takeroot/ |
| Deploy | `.github/workflows/deploy.yml` — rebuilds on every push to `main`, gated on tests, typecheck and content validation |
| Local | `npm run dev` → http://localhost:5173 |

**The live site and localhost are different origins**, so they hold entirely
separate IndexedDB databases and therefore separate study histories. This is
the single most important consequence of deploying, and it is not yet solved
for the user — see item 1 below.

---

## Current state

Working: content pipeline with validation and markdown-table support, FSRS-6
scheduling, card generation with tier gating, leech detection, the full gym
escalation, session queue with a settable length, an unlocked path where
tapping any lesson studies it directly, a Settings word list to remove or add
words and lessons (search-filterable, non-destructive), Extras (writing
practice + mnemonics), three exercises (flashcard / typing with an on-screen
Hebrew keyboard / matching), mnemonic builder with a worked example, backup
export/import, local persistence, GitHub Pages deployment.

A note on the session cap, measured rather than assumed. Running the real
`buildSession` loop over the actual 204-word course for 200 days, answering
every card with no Easy ratings and no rest days, the steady-state daily load
once caught up is about 12 cards. A cap of 12 therefore holds a standing
backlog of roughly 70 indefinitely; the backlog clears completely at 18 and
above, where typical days still come out around 12 cards. The default is 12
because a short sitting was the explicit request, but 20 is the setting that
lets the course finish.

Next, roughly in order:

1. Push notifications (iOS 16.4+ supports them for installed PWAs), now that
   the PWA manifest and service worker are in place.
2. The four spec'd but unbuilt exercises: multiple choice, speed round, cloze,
   form drills. (`GymRunner` currently filters out `speed` steps.)
3. **Confusable words** — link words by shared root, spelling distance and
   sound distance; when two linked words are both struggling, put them in the
   same matching grid. Contrastive practice is what resolves interference.
   Spec'd in `docs/PLAN.md`.
4. Verb conjugation (binyanim) — the big grammar piece. The content has 14
   verbs listed as present-tense participles with separate masculine and
   feminine entries, which is how the source course teaches them.
5. FSRS parameter optimizer (`fsrs-browser`, WASM) once there's history to
   train on.
6. In-app editing that writes back to `content/hebrew/*.md` itself, so a word
   added or edited in the app becomes part of the authored course rather than
   a runtime overlay next to it. Adding words/lessons and hiding words in
   Settings both work today (see the two decisions above) - what's still
   missing is folding a custom word into the real content file, and editing
   an existing authored word from inside the app at all.
7. Playwright end-to-end and an accessibility pass.

Worth a review pass, and flagged to the user: the part-of-speech and lesson
groupings in `content/hebrew/` were assigned mechanically, not by them. Known
soft spots are `ישן` filed as a verb though it also means "old", `טובה` folded
in as a feminine form though it also means "a favour", and the thematic
regrouping generally, which overrode the source course's own teaching order.

Explicitly tabled: generated mnemonic suggestions ("make one for me"). The
elaboration is where the encoding happens, so a finished mnemonic trades away
most of the benefit. If built, suggestions should appear only after a real
attempt or a long stall, as raw material rather than a finished answer.
