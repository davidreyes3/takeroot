# Writing vocabulary files

Drop `.md` files in `content/hebrew/`. The app reads them, generates the cards,
and works out what it can for itself. Run `npm run content:check` to see what it
could not work out and would like you to confirm.

## The shortest thing that works

```markdown
## Adjectives

- קָטָן = small
```

That is a complete, valid entry. From it the app derives:

| | |
|---|---|
| transliteration | `katan` — read off the niqqud |
| gender / number | masculine singular — from the ending |
| root | ק-ט-נ — a guess, flagged for you to confirm |
| agreement table | קטנה · קטנים · קטנות |
| cards | 6 of them, introduced gradually |

## The full form

Fields come after the gloss, each introduced by a semicolon:

```markdown
- לָבָן = white ; root: ל-ב-נ ; ex: החולצה לבנה | The shirt is white
```

Rules: `=` separates Hebrew from English. Commas separate multiple glosses.
Semicolons separate fields, so **a gloss cannot contain a semicolon**.

### Fields

| Field | Example | Notes |
|---|---|---|
| `pos` | `pos: noun` | Usually unnecessary — the `##` heading sets it |
| `gender` | `gender: f` | `m`, `f`, or `mf`. Overrides the guess |
| `number` | `number: pl` | `sg`, `pl`, `dual` |
| `root` | `root: ק-ט-נ` | Split on hyphens |
| `tr` | `tr: kaTAN` | Overrides the generated transliteration |
| `ms` `fs` `mp` `fp` | `fs: קְטַנָּה` | Override one generated form; the rest still generate |
| `ex` | `ex: הכלב קטן \| The dog is small` | Repeatable. `\|` splits Hebrew from English |
| `note` | `note: also means "young"` | Free text shown on the card back |
| `tags` | `tags: food travel` | Space or comma separated |

### Headings set the part of speech

```markdown
## Nouns
- יֶלֶד = boy, child

## Adjectives
- גָּדוֹל = big
```

Recognised headings: `Nouns`, `Verbs`, `Adjectives`, `Adverbs`, `Prepositions`,
`Pronouns`, `Numbers`, `Particles`, `Phrases` (singular forms work too).

### Frontmatter sets the unit

```markdown
---
unit: 3
title: Colours
tags: [visual]
---
```

`unit` is what orders the path. Words are introduced unit by unit, and within a
unit in the order you wrote them — so the sequence you author is the sequence
you learn.

## Things worth knowing

**Add niqqud.** Without vowel points the app cannot generate a transliteration
and will not guess one. If you would rather not point every word, add
`tr: shalom` by hand instead.

**Generated forms are unpointed on purpose.** The app can reliably produce
קטנה from קטן, but not קְטַנָּה — correct vowels need real morphology, not a
suffix rule. If you want pointed forms on the cards, supply them:
`fs: קְטַנָּה`. Anything you supply always wins over anything generated.

**Noun plurals are guesses.** אָב → אָבוֹת, not אבים. The app knows it is
guessing and will always ask you to confirm; adjective agreement is far more
regular and is trusted.

**Editing is safe.** A word's identity is its consonantal spelling plus its
part of speech. Fix a translation, add niqqud, move it to another file, or
re-sort the whole file — its review history follows. Change the Hebrew spelling
itself and it becomes a new word, which is usually what you want.

**Deleting is safe too.** Remove a word and its cards become *orphans*: they
are reported, not deleted, so nothing is lost if you were only reorganising.

## Checking your work

```bash
npm run content:check
```

Reports three levels:

- **error** — the entry did not load. Always fix these.
- **warning** — it loaded, but the app had to guess something. Worth a look.
- **info** — cosmetic.
