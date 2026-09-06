# Hebrew trainer

A spaced-repetition language app: research-grade scheduling, a game-like path,
and a real intervention for the words that refuse to stick.

Works for any language — the Hebrew-specific parts (niqqud, agreement rules)
are isolated in `packages/core/src/hebrew.ts` and `grammar/`.

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
