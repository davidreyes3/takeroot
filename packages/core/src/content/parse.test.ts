import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseContentFile, parseContentFiles, lexemeId } from './parse.js';

const FILE = 'content/hebrew/test.md';

function parse(src: string) {
  return parseContentFile(src, FILE);
}

describe('minimum viable entry', () => {
  it('parses `- hebrew = english` with only a pos heading for context', () => {
    const { lexemes, issues } = parse(`## Adjectives\n\n- קָטָן = small\n`);
    expect(lexemes).toHaveLength(1);
    expect(lexemes[0]).toMatchObject({
      lemma: 'קָטָן',
      lemmaBare: 'קטן',
      glosses: ['small'],
      pos: 'adj',
    });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('accepts multiple glosses separated by commas', () => {
    const { lexemes } = parse(`## Nouns\n- יֶלֶד = boy, child, kid\n`);
    expect(lexemes[0]?.glosses).toEqual(['boy', 'child', 'kid']);
  });
});

describe('frontmatter', () => {
  it('reads unit, title and tags', () => {
    const { lexemes } = parse(
      `---\nunit: 3\ntitle: Colors\ntags: [basic, visual]\n---\n\n## Adjectives\n- לָבָן = white\n`,
    );
    expect(lexemes[0]?.unit).toBe(3);
    expect(lexemes[0]?.tags).toEqual(expect.arrayContaining(['basic', 'visual']));
  });

  it('defaults unit to 1 when absent', () => {
    expect(parse(`## Nouns\n- ילד = boy\n`).lexemes[0]?.unit).toBe(1);
  });
});

describe('derivation and provenance', () => {
  it('derives transliteration from niqqud and marks it derived', () => {
    const { lexemes } = parse(`## Nouns\n- שָׁלוֹם = peace\n`);
    expect(lexemes[0]?.translit).toMatchObject({ value: 'shalom', provenance: 'derived' });
  });

  it('lets an authored transliteration win', () => {
    const { lexemes } = parse(`## Nouns\n- שָׁלוֹם = peace ; tr: shaLOM\n`);
    expect(lexemes[0]?.translit).toMatchObject({ value: 'shaLOM', provenance: 'authored' });
  });

  it('warns instead of guessing when there is no niqqud', () => {
    const { lexemes, issues } = parse(`## Nouns\n- שלום = peace\n`);
    expect(lexemes[0]?.translit.value).toBe('');
    expect(issues.some((i) => /no niqqud/i.test(i.message))).toBe(true);
  });

  it('derives gender and number from the ending', () => {
    const { lexemes } = parse(`## Nouns\n- יַלְדָּה = girl\n`);
    expect(lexemes[0]?.gender).toMatchObject({ value: 'f', provenance: 'derived' });
    expect(lexemes[0]?.number).toMatchObject({ value: 'sg' });
  });

  it('lets an authored gender win over the guess', () => {
    // עִיר (city) is feminine despite looking masculine - exactly the case
    // the heuristic gets wrong, so the override has to work.
    const { lexemes } = parse(`## Nouns\n- עִיר = city ; gender: f\n`);
    expect(lexemes[0]?.gender).toMatchObject({ value: 'f', provenance: 'authored' });
  });

  it('marks a guessed root as suggested, never authored', () => {
    const { lexemes } = parse(`## Adjectives\n- קטנים = small (m.pl)\n`);
    expect(lexemes[0]?.root.provenance).toBe('suggested');
  });

  it('marks an explicit root as authored and splits on hyphens', () => {
    const { lexemes } = parse(`## Adjectives\n- קָטָן = small ; root: ק-ט-נ\n`);
    expect(lexemes[0]?.root).toMatchObject({ value: ['ק', 'ט', 'נ'], provenance: 'authored' });
  });
});

describe('inflection', () => {
  it('generates the full agreement table for adjectives', () => {
    const { lexemes } = parse(`## Adjectives\n- קָטָן = small\n`);
    const forms = lexemes[0]?.forms;
    expect(forms?.fs?.value).toBe('קטנה');
    expect(forms?.mp?.value).toBe('קטנים');
    expect(forms?.fp?.value).toBe('קטנות');
    expect(forms?.fs?.provenance).toBe('derived');
  });

  it('lets an authored form override the generated one', () => {
    // Irregular: the generated feminine would be wrong here.
    const { lexemes } = parse(`## Adjectives\n- קָטָן = small ; fs: קְטַנָּה\n`);
    expect(lexemes[0]?.forms.fs).toMatchObject({ value: 'קְטַנָּה', provenance: 'authored' });
    expect(lexemes[0]?.forms.mp?.provenance).toBe('derived');
  });

  it('does not invent an agreement table for nouns', () => {
    const { lexemes } = parse(`## Nouns\n- יֶלֶד = boy\n`);
    expect(lexemes[0]?.forms.fs).toBeUndefined();
  });
});

describe('examples', () => {
  it('parses example sentences', () => {
    const { lexemes } = parse(`## Adjectives\n- קָטָן = small ; ex: הכלב קטן | The dog is small\n`);
    expect(lexemes[0]?.examples).toEqual([{ he: 'הכלב קטן', en: 'The dog is small' }]);
  });

  it('accepts several examples on one entry', () => {
    const { lexemes } = parse(
      `## Adjectives\n- קָטָן = small ; ex: א | one ; ex: ב | two\n`,
    );
    expect(lexemes[0]?.examples).toHaveLength(2);
  });

  it('warns on a malformed example rather than dropping it silently', () => {
    const { issues } = parse(`## Adjectives\n- קָטָן = small ; ex: no pipe here\n`);
    expect(issues.some((i) => /ex:/.test(i.message))).toBe(true);
  });
});

describe('error handling', () => {
  it('reports an entry with no part of speech', () => {
    const { lexemes, issues } = parse(`- קָטָן = small\n`);
    expect(lexemes).toHaveLength(0);
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/part of speech/i);
  });

  it('accepts an inline pos when there is no heading', () => {
    const { lexemes } = parse(`- קָטָן = small ; pos: adj\n`);
    expect(lexemes[0]?.pos).toBe('adj');
  });

  it('reports a missing `=` with the right line number', () => {
    const { issues } = parse(`## Nouns\n- ילד\n`);
    expect(issues.filter((i) => i.severity === 'error')[0]).toMatchObject({
      severity: 'error',
      line: 2,
    });
  });

  it('reports an entry with no Hebrew', () => {
    const { issues } = parse(`## Nouns\n- boy = boy\n`);
    expect(issues.some((i) => /no Hebrew/i.test(i.message))).toBe(true);
  });

  it('keeps parsing after a bad line', () => {
    const { lexemes, issues } = parse(`## Nouns\n- broken line\n- יֶלֶד = boy\n`);
    expect(lexemes).toHaveLength(1);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
  });

  it('reports duplicates within a file', () => {
    const { lexemes, issues } = parse(`## Nouns\n- יֶלֶד = boy\n- יֶלֶד = child\n`);
    expect(lexemes).toHaveLength(1);
    expect(issues.some((i) => /Collides/i.test(i.message))).toBe(true);
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(() => parseContentFile(s, FILE)).not.toThrow();
      }),
    );
  });
});

describe('stable ids', () => {
  it('is unchanged when the gloss is edited', () => {
    const a = parse(`## Adjectives\n- קָטָן = small\n`).lexemes[0]?.id;
    const b = parse(`## Adjectives\n- קָטָן = little, tiny\n`).lexemes[0]?.id;
    expect(a).toBe(b);
  });

  it('is unchanged when niqqud is added or removed', () => {
    expect(lexemeId('קטן', 'adj')).toBe(lexemeId('קָטָן', 'adj'));
  });

  it('is unchanged when the word moves to another file', () => {
    const a = parseContentFile(`## Adjectives\n- קָטָן = small\n`, 'a.md').lexemes[0]?.id;
    const b = parseContentFile(`## Adjectives\n- קָטָן = small\n`, 'b.md').lexemes[0]?.id;
    expect(a).toBe(b);
  });

  it('differs when the part of speech differs', () => {
    expect(lexemeId('אור', 'noun')).not.toBe(lexemeId('אור', 'verb'));
  });

  it('is ASCII, so it is safe as a database key', () => {
    expect(lexemeId('קָטָן', 'adj')).toMatch(/^lx_[a-z0-9]+$/u);
  });

  it('separates a minimal pair that differs only in niqqud, via an explicit key', () => {
    // מוֹרֶה (male teacher) and מוֹרָה (female teacher) are both מורה unpointed.
    const { lexemes, issues } = parse(
      `## Nouns
- מוֹרֶה = teacher (m)
- מוֹרָה = teacher (f) ; key: f
`,
    );
    expect(lexemes).toHaveLength(2);
    expect(lexemes[0]?.id).not.toBe(lexemes[1]?.id);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('still collides, loudly, when the key is missing', () => {
    const { lexemes, issues } = parse(`## Nouns
- מוֹרֶה = teacher (m)
- מוֹרָה = teacher (f)
`);
    expect(lexemes).toHaveLength(1);
    expect(issues.some((i) => /minimal pair/.test(i.message))).toBe(true);
  });

  it('leaves the un-keyed id untouched when a key is added to its twin', () => {
    // This is the property that makes the scheme safe: disambiguating later
    // must not rewrite the id of the word that already has review history.
    const before = parse(`## Nouns
- מוֹרֶה = teacher (m)
`).lexemes[0]?.id;
    const after = parse(`## Nouns
- מוֹרֶה = teacher (m)
- מוֹרָה = teacher (f) ; key: f
`)
      .lexemes[0]?.id;
    expect(after).toBe(before);
  });
});

describe('parseContentFiles', () => {
  it('merges files and sorts by unit', () => {
    const { lexemes } = parseContentFiles([
      { path: 'b.md', source: `---\nunit: 2\n---\n## Nouns\n- יֶלֶד = boy\n` },
      { path: 'a.md', source: `---\nunit: 1\n---\n## Adjectives\n- קָטָן = small\n` },
    ]);
    expect(lexemes.map((l) => l.unit)).toEqual([1, 2]);
  });

  it('reports a duplicate defined across two files', () => {
    const { lexemes, issues } = parseContentFiles([
      { path: 'a.md', source: `## Adjectives\n- קָטָן = small\n` },
      { path: 'b.md', source: `## Adjectives\n- קטן = small\n` },
    ]);
    expect(lexemes).toHaveLength(1);
    expect(issues.some((i) => /Already defined in a\.md/.test(i.message))).toBe(true);
  });
});

describe('HTML comments', () => {
  /**
   * Regression: only the opening `<!--` line was skipped, so worked examples
   * written inside a comment block were parsed as real vocabulary. The starter
   * files' own instructions triggered this.
   */
  it('ignores entries inside a multi-line comment', () => {
    const { lexemes } = parse(
      `## Nouns\n<!--\nPaste words like this:\n- כֶּלֶב = dog\n-->\n- יֶלֶד = boy\n`,
    );
    expect(lexemes).toHaveLength(1);
    expect(lexemes[0]?.glosses).toEqual(['boy']);
  });

  it('ignores a single-line comment', () => {
    const { lexemes } = parse(`## Nouns\n<!-- - כֶּלֶב = dog -->\n- יֶלֶד = boy\n`);
    expect(lexemes).toHaveLength(1);
  });

  it('resumes parsing after the comment closes', () => {
    const { lexemes } = parse(
      `## Nouns\n- אִישׁ = man\n<!--\n- כֶּלֶב = dog\n-->\n- יֶלֶד = boy\n`,
    );
    expect(lexemes.map((l) => l.glosses[0])).toEqual(['man', 'boy']);
  });

  it('does not report a comment example as a duplicate', () => {
    const { issues } = parse(`## Nouns\n- יֶלֶד = boy\n<!--\n- יֶלֶד = boy\n-->\n`);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('survives an unterminated comment without eating the whole file', () => {
    // Malformed, but it must not throw or silently lose everything above it.
    const { lexemes } = parse(`## Nouns\n- יֶלֶד = boy\n<!--\n- כֶּלֶב = dog\n`);
    expect(lexemes.map((l) => l.glosses[0])).toEqual(['boy']);
  });
});

describe('markdown tables', () => {
  const table = (rows: string) =>
    `## Nouns\n\n| # | Hebrew | Pronunciation | English |\n|---|--------|---------------|---------|\n${rows}`;

  it('reads a vocabulary table', () => {
    const { lexemes, issues } = parse(table('| 1 | מים | mayim | water |\n| 2 | סוס | sus | horse, a horse |\n'));
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    expect(lexemes).toHaveLength(2);
    expect(lexemes[0]).toMatchObject({ lemma: 'מים', glosses: ['water'], pos: 'noun' });
    expect(lexemes[1]?.glosses).toEqual(['horse', 'a horse']);
  });

  it('takes the pronunciation column as an authored transliteration', () => {
    // Authored beats derived: a course's own pronunciation is better evidence
    // than anything generated from niqqud.
    const { lexemes } = parse(table('| 1 | מים | mayim | water |\n'));
    expect(lexemes[0]?.translit).toMatchObject({ value: 'mayim', provenance: 'authored' });
  });

  it('ignores an index column and any column it does not recognise', () => {
    const src =
      `## Nouns\n\n| # | Hebrew | English | My private notes |\n|---|---|---|---|\n| 7 | סוס | horse | remember this one |\n`;
    const { lexemes, issues } = parse(src);
    expect(lexemes).toHaveLength(1);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('accepts optional pos, gender, root, key and group columns', () => {
    const src =
      `| Hebrew | English | Pos | Gender | Root | Group |\n|---|---|---|---|---|---|\n` +
      `| כלב | dog | noun | m | כ-ל-ב | Animals |\n`;
    const { lexemes } = parse(src);
    expect(lexemes[0]).toMatchObject({ pos: 'noun', group: 'Animals' });
    expect(lexemes[0]?.gender).toMatchObject({ value: 'm', provenance: 'authored' });
    expect(lexemes[0]?.root).toMatchObject({ value: ['כ', 'ל', 'ב'], provenance: 'authored' });
  });

  it('lets a key column separate rows spelled the same without niqqud', () => {
    const src =
      `## Phrases\n\n| Hebrew | Pronunciation | English | Key |\n|---|---|---|---|\n` +
      `| מה שלומך | ma shlomcha | how are you (m) | |\n` +
      `| מה שלומך | ma shlomech | how are you (f) | f |\n`;
    const { lexemes, issues } = parse(src);
    expect(lexemes).toHaveLength(2);
    expect(lexemes[0]?.id).not.toBe(lexemes[1]?.id);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('reports a collision when no key distinguishes the rows', () => {
    const { lexemes, issues } = parse(
      table('| 1 | לך | lecha | to you (m) |\n| 2 | לך | lach | to you (f) |\n'),
    );
    expect(lexemes).toHaveLength(1);
    expect(issues.some((i) => /Collides/.test(i.message))).toBe(true);
  });

  it('skips a table with no Hebrew column, and says so', () => {
    const src = `## Nouns\n\n| Foo | Bar |\n|---|---|\n| a | b |\n`;
    const { lexemes, issues } = parse(src);
    expect(lexemes).toHaveLength(0);
    expect(issues.some((i) => /no column named Hebrew/i.test(i.message))).toBe(true);
  });

  it('handles a table without leading and trailing pipes only when piped', () => {
    // Rows must start with a pipe to be treated as table rows at all.
    const { lexemes } = parse(`## Nouns\n\nHebrew | English\nמים | water\n`);
    expect(lexemes).toHaveLength(0);
  });

  it('ends the table at the next heading and resumes normal parsing', () => {
    const src =
      `## Animals\n\n| Hebrew | English | Pos |\n|---|---|---|\n| כלב | dog | noun |\n\n` +
      `## Adjectives\n\n- קָטָן = small\n`;
    const { lexemes } = parse(src);
    expect(lexemes.map((l) => l.group)).toEqual(['Animals', 'Adjectives']);
    expect(lexemes[1]?.pos).toBe('adj');
  });

  it('lets bullets and tables coexist in one file', () => {
    const src =
      `## Nouns\n\n- יֶלֶד = boy\n\n| Hebrew | English |\n|---|---|\n| כלב | dog |\n`;
    const { lexemes } = parse(src);
    expect(lexemes.map((l) => l.glosses[0])).toEqual(['boy', 'dog']);
  });

  it('never throws on a malformed table', () => {
    fc.assert(
      fc.property(fc.array(fc.fullUnicodeString(), { maxLength: 6 }), (cells) => {
        const src = `## Nouns\n| Hebrew | English |\n|---|---|\n| ${cells.join(' | ')} |\n`;
        expect(() => parseContentFile(src, FILE)).not.toThrow();
      }),
    );
  });
});
