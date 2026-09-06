# Hebrew trainer — design and plan

The thesis in one line: **research-grade scheduling, a game-like path, and a
real answer for the words that won't stick.**

The serious flashcard tools have the best scheduling in the business and a
miserable ramp. The gamified language apps have the best ramp and a scheduler
that mostly ignores what you personally forget. Neither does anything useful
about the twenty words that defeat you — the flashcard tools tag them and
suspend them, which is giving up. That gap is the product.

---

## 1. Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Platform | React + Vite PWA → Capacitor later | Installs to your iPhone home screen for free, offline, no App Store. Capacitor wraps the *same* code if you ever want a store listing. |
| Storage | Local-first, IndexedDB (Dexie) | No account, no server bill, works on a plane. `SyncAdapter` seam is stubbed for later. |
| Scheduler | `ts-fsrs` 5.4.2 (FSRS-6) | MIT, zero dependencies, 21-weight FSRS-6. Reimplementing a fitted model is how you get a worse one. |
| Content | Hand-written markdown in `content/` | You author words; the app derives gender, number, root and inflections. |

### On the iOS cost, since it motivated this

The established flashcard app's iOS version is a one-off ~$30, and that money
genuinely funds its development. The reason to build instead is not that $30 is
outrageous — it's that you want an app shaped differently. Worth knowing before
you plan around the App Store:
**shipping any app to your own iPhone through the store costs $99/year**, which
is worse than $30 once. The PWA route sidesteps this entirely: Safari → Share →
Add to Home Screen gives you an offline, fullscreen, icon-on-the-springboard
app for nothing, and since iOS 16.4 it can send push notifications too. That is
the recommended target, and it is why the stack is a web app first.

---

## 2. How FSRS actually works

Three numbers per card:

- **Stability (S)** — days for recall probability to fall from 100% to 90%.
- **Difficulty (D)** — 1–10, how hard it is to *grow* stability on this card.
- **Retrievability (R)** — probability you'd recall it right now.

The forgetting curve in FSRS-6:

```
R(t, S) = (1 + factor · t/S) ^ (−w₂₀)      factor = 0.9^(−1/w₂₀) − 1
```

Scheduling is just inverting that: solve for the `t` where `R` equals your
**desired retention**. After each review, S and D update through ~21 fitted
weights — different formulas for a pass and a lapse, with difficulty
mean-reverting so one bad day doesn't permanently poison a card.

The genuinely interesting property: those 21 weights can be **retrained on your
own review history**, so the schedule fits your memory rather than the average
person's. That's why `ReviewLog` is append-only and never rewritten (§5) —
it *is* the training set.

### What desired retention costs

Simulated, 500 words, one year (`npm run sim`):

| Desired retention | Total reviews | Reviews/day at 1 year | Busiest day |
|---|---|---|---|
| 0.80 | 4,526 | 3.5 | 64 |
| 0.85 | 5,138 | 5.2 | 64 |
| **0.90** | **6,584** | **7.2** | 76 |
| 0.95 | 11,193 | 17.8 | 106 |

Going from 0.90 to 0.95 costs **70% more reviews for about 3 points of
retention**. Default is 0.90; the setting is clamped to 0.70–0.98 so nobody can
accidentally sign up for the 0.99 death march.

**Honest caveat:** the simulated learner *is* the FSRS forgetting curve, so this
is a self-consistency check. It catches integration bugs — wrong units, dropped
reviews, mutated state — not flaws in FSRS itself.

---

## 3. Architecture

```
packages/core     pure TypeScript. No React, no Dexie, no DOM.
  hebrew.ts         niqqud, final forms, comparison, transliteration
  grammar/          inflection rules
  content/          markdown parser + validator CLI
  scheduler.ts      ts-fsrs wrapper, auto-grading
  cards.ts          lexeme → card family, tier gating
  leech.ts          detection + the gym
  session.ts        the queue builder
  simulate.ts       learner simulator / load generator

apps/web          React + Vite PWA
  db.ts             Dexie, export/import, SyncAdapter seam
  store.ts          zustand; coordinates, never decides
  screens/          path, session
  exercises/        flashcard, type, matching, gym runner
  components/       Word (RTL isolation), agreement table, mnemonic builder

content/hebrew/   your markdown vocabulary files
```

The boundary is enforced by a test, not a convention:
`architecture.test.ts` fails the build if core ever imports React, Dexie,
zustand, or touches `window`/`document`/`indexedDB`. That boundary is exactly
what makes the Capacitor migration a repackaging job instead of a rewrite.

---

## 4. The content pipeline

You write this:

```markdown
## Adjectives
- קָטָן = small ; root: ק-ט-נ
```

The app derives: `katan` (from the niqqud), masculine singular (from the
ending), and the agreement table **קטנה · קטנים · קטנות** — plus the rule that
produced it. Full format: [`content/README.md`](../content/README.md).

Everything derived is tagged `authored` / `derived` / `suggested`, so the UI
can show a guessed root as a guess and `npm run content:check` can hand you a
to-do list instead of silently inventing facts.

### Two things this design got right, discovered by building it

**Generated forms are unpointed on purpose.** The app can reliably turn קטן into
קטנה, but not into קְטַנָּה — correct vowels need real morphology, since stem
vowels reduce (גָּדוֹל → גְּדוֹלָה) in ways no suffix rule predicts. So generated
forms are consonantal, which is how Hebrew is written anyway, and anything you
author always wins.

**Word identity ignores niqqud, which needed a fix.** Identity is (consonantal
spelling + part of speech), so you can retranslate, add vowel points, or move a
word between files without losing months of history. But that means **מוֹרֶה**
(male teacher) and **מוֹרָה** (female teacher) collide — they're both `מורה`
unpointed, and Hebrew is full of such minimal pairs. The validator caught this
on the starter content. Folding niqqud back into identity would break history
the day you point a word, so instead the second entry declares `; key: f`.
Adding a key only ever touches an entry that was already colliding, so nothing
with real history changes id.

---

## 5. Data model

**Lexeme** — one word. Lemma, glosses, part of speech, gender, number, root,
inflected forms, examples, tags, unit, mnemonic. Every derived field is a
`Sourced<T>` carrying its provenance.

**Card** — one schedulable prompt, generated from a lexeme × template. Holds
the FSRS state, `againStreak`, `isLeech`, `suspended`.

Templates per word, gated by **tier** so a new word costs one card today, not six:

| Tier | Templates | Unlocks when |
|---|---|---|
| 1 | `recall_he_en` | immediately |
| 2 | `recall_en_he`, `type_he`, `cloze` | tier 1 reaches Review |
| 3 | `form_fs`, `form_mp`, `form_fp` | tier 2 reaches Review |

**ReviewLog** — append-only, never mutated, never deleted. Records the card
state *before* the review, the rating, the duration, the exercise, and
`countsForScheduling`. This is the FSRS optimizer's training set; rewriting it
would silently corrupt your personalised weights.

Timestamps are epoch milliseconds, never `Date` objects — Dates don't survive
IndexedDB round-trips or JSON export cleanly, and shared mutable Dates are a
classic source of "why did this card's due date change".

---

## 6. The Leech Gym

The differentiator. A card is flagged when **any** of:

- 4+ total lapses (the conventional default is 8; with an intervention
  available, catching it early is cheap, and 8 failed reviews is weeks of
  frustration)
- 3 consecutive `Again`s
- under 60% accuracy across the last 6 scheduled reviews

Then it escalates, ordered by evidence strength rather than novelty:

1. **Study** — re-encode it properly. Word, transliteration, meaning, agreement
   table. You asked not to open with a challenge; this is that.
2. **Mnemonic** — only when repetition has *already* failed. §8.
3. **Expanding drill** — your "pound it in, go away, come back" mechanic. The
   target reappears at gaps of 0, 1, 2, then 4 filler items.
4. **Matching** — recognition under mild pressure.
5. **Speed round** — recognition under real pressure, high severity only. Time
   pressure on a word you barely know produces guessing, not learning.
6. **Final test** — one typed production recall.

### Why drills are not reviews

**Only step 6 touches the schedule.** Steps 1–5 are logged with
`countsForScheduling: false` — recorded for analytics, invisible to FSRS.

This matters more than it sounds. If massed in-session repetition fed the
scheduler, drilling a word eight times in four minutes would inflate its
stability enormously, and FSRS would conclude you've mastered a word you'll
have lost by tomorrow. Success five seconds after seeing the answer is evidence
about your short-term buffer, not your memory. So the gym ends on a single
*production* test — typing, where you cannot guess — and that one answer is
what reschedules the card.

Expanding gaps rather than fixed ones because each successful recall then
happens near the edge of forgetting, which is where strengthening happens.

---

## 7. Exercises and auto-grading

| Exercise | Kind | Built |
|---|---|---|
| Flashcard, self-graded | recall | ✅ |
| Type the answer | production | ✅ |
| Matching grid | recognition | ✅ |
| Multiple choice | recognition | spec'd |
| Speed round | recognition, timed | spec'd |
| Cloze sentence | production in context | spec'd |
| Form drill (agreement) | production | spec'd |
| Listening (TTS) | recognition | later |

Auto-graded results map to FSRS ratings like this:

- **Wrong → Again.** No partial credit; a lapse is a lapse.
- **Hint used → capped at Hard.** Recall with scaffolding isn't recall.
- **Slow but correct → Hard.** Retrieval latency is a real signal of weak
  memory strength, and it's precisely the signal a self-graded card throws
  away. "Slow" is 2.5× your rolling median, floored at 6s so fast learners
  aren't punished for normal speed.
- **Easy is only available on production exercises.** A fast correct answer on
  a four-option question might be a lucky guess; handing that an Easy would
  badly inflate the interval. Recognition caps at Good.

### Typing is forgiving about typography, strict about spelling

Niqqud optional, final-form slips forgiven (`לבנ` matches `לבן`), maqaf and
punctuation ignored. But `ט` vs `ת` stays wrong, because that's a real spelling
error. All of it lives in one tested function, `answersMatch`.

---

## 8. Mnemonics

The "200 Words a Day" / Linkword technique: an English **keyword** that sounds
like the Hebrew, plus a deliberately **absurd image** linking it to the
meaning. Two separate fields on purpose — a vague "sounds a bit like cotton"
with no picture attached doesn't stick.

Two deliberate constraints:

- **You write it, not the app.** A mnemonic someone else invented is just
  another sentence to memorise; the elaboration is where the encoding happens.
- **Only offered for stubborn words.** Inventing absurd imagery for every word
  is exhausting, and the technique works best held in reserve.

Once saved, it surfaces on that word's card backs and in its gym sessions.

---

## 9. The path

Units come from the frontmatter; each is chunked into lessons of six words —
small enough to finish in one sitting, which is the psychological trick of a
stepping-stone path. Mastery rings are drawn with a conic gradient, no SVG.

A node unlocks at **60% mastery of the previous one**, not 100%. Requiring
perfection would gate the whole course behind whichever single word you find
impossible — and that word is exactly what the gym is for. It shouldn't stand
between you and new material.

Two tracks are planned: **vocabulary** (word → meaning) and **grammar**
(pattern → produce the form). Tier-3 agreement cards are the seed of the second.

---

## 10. Session rules

Order, and why:

1. **Warm-up** — 3 healthy due cards. Momentum, not a cold challenge.
2. **Gym** — struggling words while attention is fresh.
3. **Reviews** — the rest of the backlog.
4. **New** — last, and only if the backlog is under control.

Caps: 60 reviews, 8 new, 3 gym sessions. **New words are withheld entirely
above 80 due cards** — the failure mode that kills SRS habits is opening the app
to a 400-card wall, and it's self-inflicted by introducing new material while
behind. One card per word per session (sibling burying): seeing קטן twice in
five minutes teaches you the session, not the word.

---

## 11. Testing

TDD as asked, and the bugs it caught were real ones — a vav read as a consonant
instead of a vowel (`shalvom`), root-peeling comparing against final letters
that had already been normalised away, and the minimal-pair collision in §4.

**187 tests, all passing.**

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | text handling, inflection, parser, scheduler, leech rules, queue |
| Property-based | fast-check | invariants over thousands of generated inputs |
| Integration | fake-indexeddb | real Dexie writes, real content files |
| Component | Testing Library | render, click through a session, RTL correctness |
| Architecture | custom | core imports no UI framework |
| Simulation | custom | 365-day runs, workload, retention |

Property tests worth calling out, because they cover cases nobody writes by
hand: intervals are monotonic in rating (Again ≤ Hard ≤ Good ≤ Easy) across
thousands of random review histories; stability is never negative, difficulty
never leaves 1–10, due dates never land in the past, nothing is ever NaN; and
text normalisation never throws on arbitrary Unicode.

**Not yet built:** Playwright end-to-end, visual regression, and an accessibility
audit with a screen reader.

---

## 12. Memory and performance

You raised this explicitly, so it's tested rather than asserted:

- **Bounded queries.** The session builder never loads full history. Logs are
  fetched capped per card, and a test proves the plan is *identical* given 6 log
  rows or 2,000 — so the bounded window is safe rather than lossy.
- **Bounded output.** 5,000 cards in, ≤70 items out.
- **No accidental O(n²).** A test asserts 8× the data costs well under 24× the
  time, which catches the quadratic that's invisible at 50 cards and fatal at
  5,000.
- **No mutation.** `reviewCard` and `buildSession` never mutate inputs; a test
  corrupts the input object afterwards and asserts the output is unaffected.
- **Timer cleanup.** Every `setTimeout` is cleared on unmount — a stray callback
  holding component state alive is the classic React leak.
- **Bounded in-memory state.** Rolling timing window capped at 30 samples.

---

## 13. Notifications

As a PWA on iOS 16.4+, installed to the home screen, the Web Push API works —
no email fallback needed. Plan: a daily local reminder at a time you choose,
plus a "your backlog is growing" nudge. Deliberately *not* a streak that
punishes you for missing a day; that mechanic drives cramming, which is the
opposite of what spaced repetition is for.

---

## 14. Where things stand

**Working now:** content pipeline with validation, FSRS-6 scheduling, card
generation with tier gating, leech detection, the full gym escalation, session
queue, path screen, three exercises, mnemonic builder, local persistence,
export/import.

**Next, in order:**

1. Multiple choice, speed round, cloze, form drills — the four spec'd exercises
2. Verb conjugation (binyanim) — the big grammar piece, needs real morphology
3. PWA manifest + service worker + push notifications
4. FSRS parameter optimizer (`fsrs-browser`, WASM) once there's history to train
5. In-app card editing writing back to markdown
6. Audio — TTS, or recorded, for listening exercises
7. Playwright end-to-end and an accessibility pass

---

## 15. Open questions

1. **Verbs are the real work.** Hebrew verb morphology is seven binyanim ×
   tense × person × gender × number. Hand-authored tables per verb, or a rule
   engine? A rule engine is weeks of work and will still be wrong on weak roots.
   I'd start with hand-authored tables for the ~50 verbs you actually need.
2. **How much niqqud?** Fully pointed is best for learning and slow to author.
   Consonantal-only is fast and loses the transliteration. Current answer: point
   what you can, and the app tells you what's missing.
3. **Matching the level you've already reached.** The gamified apps offer no
   vocabulary export. Realistically this means writing the units yourself, or
   marking words already-known so they enter the schedule mature instead of
   new — worth building either way.
4. **Whose Hebrew?** The starter content is Modern Israeli. Biblical Hebrew
   would want different vocabulary, and cantillation marks in the text layer.
