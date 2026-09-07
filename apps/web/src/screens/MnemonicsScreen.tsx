import { useMemo, useState } from 'react';
import type { Lexeme } from '@lang/core';
import { useApp } from '../store.js';
import { packLessons } from './PathScreen.js';
import { Word } from '../components/Word.js';
import { MnemonicBuilder } from '../components/MnemonicBuilder.js';

export interface MnemonicsScreenProps {
  lexemes: Lexeme[];
  unitTitles: Map<number, string>;
}

/**
 * Every mnemonic you have built, browsable any time - not only the moment a
 * word happens to reach the Leech Gym's mnemonic step.
 */
export function MnemonicsScreen({ lexemes, unitTitles }: MnemonicsScreenProps) {
  const { saveMnemonic } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);

  const units = useMemo(() => {
    const byUnit = new Map<number, Lexeme[]>();
    for (const lexeme of lexemes) {
      const list = byUnit.get(lexeme.unit);
      if (list) list.push(lexeme);
      else byUnit.set(lexeme.unit, [lexeme]);
    }
    return [...byUnit.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([unit, words]) => ({ unit, lessons: packLessons(words) }));
  }, [lexemes]);

  return (
    <div className="path">
      <p className="muted">
        Mnemonics you have built, available any time - not just when a word comes up in the gym.
      </p>

      {units.map(({ unit, lessons }) => (
        <section key={unit} className="unit">
          <div className="unit-head">
            <h2>{unitTitles.get(unit) ?? `Unit ${unit}`}</h2>
          </div>

          {lessons.map((lesson) => (
            <div key={lesson.title} className="stack" style={{ marginBottom: 14 }}>
              <div className="lesson-label">{lesson.title}</div>

              {lesson.lexemes.map((lexeme) =>
                editingId === lexeme.id ? (
                  <MnemonicBuilder
                    key={lexeme.id}
                    lexeme={lexeme}
                    initialKeyword={lexeme.mnemonic?.keyword ?? ''}
                    initialImage={lexeme.mnemonic?.image ?? ''}
                    cancelLabel="Close"
                    onSave={(keyword, image) => {
                      void saveMnemonic(lexeme.id, keyword, image);
                      setEditingId(null);
                    }}
                    onSkip={() => setEditingId(null)}
                  />
                ) : (
                  <button
                    key={lexeme.id}
                    type="button"
                    className="summary-row pressable"
                    onClick={() => setEditingId(lexeme.id)}
                  >
                    <span className="row">
                      <Word text={lexeme.lemma} hebrew />
                      <span className="muted">{lexeme.glosses[0]}</span>
                    </span>
                    {lexeme.mnemonic ? (
                      <span className="tag">{lexeme.mnemonic.keyword}</span>
                    ) : (
                      <span className="tag derived">add one</span>
                    )}
                  </button>
                ),
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
