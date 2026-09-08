import { useMemo, useState } from 'react';
import type { Lexeme, Pos } from '@lang/core';
import { useApp } from '../store.js';
import { Word } from '../components/Word.js';
import { HebrewKeyboard } from '../components/HebrewKeyboard.js';

export interface WordListManagerProps {
  /** The whole corpus, hidden words included - this is where you bring them back. */
  lexemes: Lexeme[];
  unitTitles: Map<number, string>;
}

const POS_OPTIONS: { value: Pos; label: string }[] = [
  { value: 'noun', label: 'Noun' },
  { value: 'verb', label: 'Verb' },
  { value: 'adj', label: 'Adjective' },
  { value: 'adv', label: 'Adverb' },
  { value: 'prep', label: 'Preposition' },
  { value: 'pron', label: 'Pronoun' },
  { value: 'num', label: 'Number' },
  { value: 'particle', label: 'Particle' },
  { value: 'phrase', label: 'Phrase' },
];

interface Group {
  name: string;
  words: Lexeme[];
}

interface UnitGroup {
  unit: number;
  groups: Group[];
}

/**
 * Bucket by unit, then by the literal `##` heading each word was written
 * under - not `packLessons`' pacing-adjusted lessons. Removing "a lesson"
 * should mean the lesson as authored, not a chunk the path merged or split
 * for a comfortable sitting size.
 */
function groupByHeading(lexemes: readonly Lexeme[]): UnitGroup[] {
  const byUnit = new Map<number, Map<string, Lexeme[]>>();
  for (const lexeme of lexemes) {
    let groups = byUnit.get(lexeme.unit);
    if (!groups) {
      groups = new Map();
      byUnit.set(lexeme.unit, groups);
    }
    const list = groups.get(lexeme.group);
    if (list) list.push(lexeme);
    else groups.set(lexeme.group, [lexeme]);
  }
  return [...byUnit.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([unit, groups]) => ({
      unit,
      groups: [...groups.entries()].map(([name, words]) => ({ name, words })),
    }));
}

function matches(lexeme: Lexeme, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    lexeme.lemma.includes(query) ||
    lexeme.lemmaBare.includes(query) ||
    lexeme.translit.value.toLowerCase().includes(q) ||
    lexeme.glosses.some((g) => g.toLowerCase().includes(q))
  );
}

/**
 * Browse, remove, restore and add to the word list.
 *
 * "Remove" hides a word from the path, sessions and Extras - it does not
 * delete anything. That has to be true for words authored in the markdown
 * content, since the app cannot write back to those files (a bigger,
 * separate piece of work - see CLAUDE.md); it is kept true for words added
 * here too, so removing behaves the same way everywhere and nothing typed in
 * by mistake needs a different undo than everything else.
 */
export function WordListManager({ lexemes, unitTitles }: WordListManagerProps) {
  const { excludedLexemeIds, setLexemeExcluded, setLexemesExcluded } = useApp();
  const [query, setQuery] = useState('');

  const unitGroups = useMemo(() => groupByHeading(lexemes), [lexemes]);

  const existingLessons = useMemo(() => {
    const names = new Set<string>();
    for (const l of lexemes) if (l.sourceFile === 'custom') names.add(l.group);
    return [...names];
  }, [lexemes]);

  const filtered = useMemo(() => {
    if (!query.trim()) return unitGroups;
    return unitGroups
      .map(({ unit, groups }) => ({
        unit,
        groups: groups
          .map((g) => ({ name: g.name, words: g.words.filter((w) => matches(w, query)) }))
          .filter((g) => g.words.length > 0),
      }))
      .filter((u) => u.groups.length > 0);
  }, [unitGroups, query]);

  return (
    <div className="stack">
      <AddWordForm existingLessons={existingLessons} />

      <div className="field">
        <label htmlFor="word-search">Search your words</label>
        <input
          id="word-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hebrew, pronunciation, or English"
          autoComplete="off"
        />
      </div>

      {filtered.length === 0 && (
        <p className="muted">No words match "{query}".</p>
      )}

      {filtered.map(({ unit, groups }) => (
        <section key={unit} className="unit">
          <div className="unit-head">
            <h2>{unitTitles.get(unit) ?? `Unit ${unit}`}</h2>
          </div>

          {groups.map((group) => {
            // A lesson still hidden from the filtered word list can still be
            // toggled as a whole - the button always acts on every word in
            // the lesson, not merely the ones the search happens to show.
            const allWords = unitGroups.find((u) => u.unit === unit)?.groups.find((g) => g.name === group.name)
              ?.words ?? group.words;
            const allExcluded = allWords.every((w) => excludedLexemeIds.has(w.id));

            return (
              <div key={group.name} className="stack" style={{ marginBottom: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="lesson-label">
                    {group.name} ({allWords.length - allWords.filter((w) => excludedLexemeIds.has(w.id)).length}/
                    {allWords.length})
                  </div>
                  <button
                    className="pill pressable"
                    onClick={() => void setLexemesExcluded(allWords.map((w) => w.id), !allExcluded)}
                  >
                    {allExcluded ? 'Restore lesson' : 'Remove lesson'}
                  </button>
                </div>

                {group.words.map((word) => {
                  const excluded = excludedLexemeIds.has(word.id);
                  return (
                    <label key={word.id} className="summary-row">
                      <span className="row">
                        <input
                          type="checkbox"
                          checked={!excluded}
                          onChange={(e) => void setLexemeExcluded(word.id, !e.target.checked)}
                          aria-label={`Study ${word.lemma}`}
                        />
                        <Word text={word.lemma} hebrew />
                        <span className="muted">{word.glosses[0]}</span>
                      </span>
                      {excluded && <span className="tag">removed</span>}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/**
 * Add a word, into a new lesson or an existing one.
 *
 * There is no separate "create a lesson" action: a lesson only exists here by
 * virtue of having words in it, so naming a lesson that doesn't exist yet
 * *is* creating it. Only lessons created this way can be extended - a name
 * that matches a lesson from the authored content starts a same-named lesson
 * of its own in "Your words" rather than editing that file, which the app
 * cannot do.
 */
function AddWordForm({ existingLessons }: { existingLessons: string[] }) {
  const addCustomWord = useApp((s) => s.addCustomWord);
  const [lemma, setLemma] = useState('');
  const [translit, setTranslit] = useState('');
  const [english, setEnglish] = useState('');
  const [pos, setPos] = useState<Pos>('noun');
  const [group, setGroup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const insert = (char: string) => setLemma((v) => v + char);
  const backspace = () => setLemma((v) => v.slice(0, -1));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const glosses = english
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await addCustomWord({ lemma, translit, glosses, pos, group });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setStatus(`Added ${lemma} to "${group.trim()}".`);
    setLemma('');
    setTranslit('');
    setEnglish('');
    // Lesson name stays, so adding several words to the same new lesson in a
    // row does not mean retyping its name every time.
  };

  return (
    <form className="card" style={{ minHeight: 0, alignItems: 'stretch', gap: 14 }} onSubmit={(e) => void submit(e)}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Add a word</div>
        <div className="muted" style={{ fontSize: 13 }}>
          Give a lesson a new name to start it, or an existing one from the list to add to it.
        </div>
      </div>

      <div className="field">
        <label htmlFor="new-word-he">Hebrew</label>
        <input
          id="new-word-he"
          className="he"
          dir="rtl"
          lang="he"
          value={lemma}
          onChange={(e) => setLemma(e.target.value)}
          autoComplete="off"
        />
      </div>
      <button type="button" className="kbd-toggle" onClick={() => setKeyboardVisible((v) => !v)}>
        {keyboardVisible ? 'Hide keyboard' : 'Show keyboard'}
      </button>
      {keyboardVisible && <HebrewKeyboard onKey={insert} onBackspace={backspace} />}

      <div className="field">
        <label htmlFor="new-word-translit">Pronunciation (optional)</label>
        <input id="new-word-translit" value={translit} onChange={(e) => setTranslit(e.target.value)} autoComplete="off" />
      </div>

      <div className="field">
        <label htmlFor="new-word-en">English meaning(s)</label>
        <input
          id="new-word-en"
          value={english}
          onChange={(e) => setEnglish(e.target.value)}
          placeholder="comma-separated if more than one"
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label htmlFor="new-word-pos">Part of speech</label>
        <select id="new-word-pos" value={pos} onChange={(e) => setPos(e.target.value as Pos)}>
          {POS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="new-word-lesson">Lesson</label>
        <input
          id="new-word-lesson"
          list="existing-lessons"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="New or existing lesson name"
          autoComplete="off"
        />
        <datalist id="existing-lessons">
          {existingLessons.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      {error && <div className="banner">{error}</div>}
      {status && <div className="banner calm">{status}</div>}

      <button type="submit" className="btn">
        Add word
      </button>
    </form>
  );
}
