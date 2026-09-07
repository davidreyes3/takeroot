# takeroot

A spaced-repetition language app: research-grade scheduling, a game-like path,
and a real intervention for the words that refuse to stick.

Most flashcard tools schedule well and start badly. Most language apps start
well and schedule badly. Neither does much about the twenty words that defeat
you — they get tagged and suspended, which is giving up. That gap is the point
of this app.

Hebrew is the first language loaded, but the engine is language-agnostic: the
Hebrew-specific parts (niqqud, agreement rules) are isolated in
`packages/core/src/hebrew.ts` and `grammar/`.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
```

## Everyday commands

```bash
npm test               # the whole suite
npm run test:watch     # while working
npm run typecheck      # tsc across the workspace
npm run content:check  # validate content/, report what the app had to guess
npm run sim            # what each retention setting costs in daily reviews
npm run build          # production build
```

## Adding words

Write markdown in `content/hebrew/`. The shortest valid entry:

```markdown
## Adjectives
- קָטָן = small
```

From that the app derives the transliteration, gender, number, a root guess,
the agreement table (קטנה · קטנים · קטנות), and six cards introduced
gradually. Full format: [`content/README.md`](content/README.md).

## Layout

| Path | What |
|---|---|
| `packages/core` | Scheduling, Hebrew text, grammar, content parsing. Pure TS. |
| `apps/web` | React PWA. |
| `content/hebrew` | Your vocabulary files. |
| `docs/PLAN.md` | Design, decisions, and what's next. |

`packages/core` imports no UI framework and touches no browser globals — a test
enforces it, which is what keeps the native path cheap.

## Design

See [`docs/PLAN.md`](docs/PLAN.md).

## A note on the seeded vocabulary

The Hebrew words in `content/hebrew/` exist to demonstrate the pipeline, not to
be a course. They were generated rather than written by a native speaker, so
check them against a source you trust before relying on them.

## Licence

MIT — see [`LICENSE`](LICENSE).
