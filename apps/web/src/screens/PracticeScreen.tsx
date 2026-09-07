import { useMemo, useState } from 'react';
import { exerciseFor, type Card, type CardTemplate, type Lexeme } from '@lang/core';
import { useApp } from '../store.js';
import { packLessons } from './PathScreen.js';
import { Word } from '../components/Word.js';
import { Flashcard } from '../exercises/Flashcard.js';
import { TypeAnswer } from '../exercises/TypeAnswer.js';

const TEMPLATE_LABELS: Record<CardTemplate, string> = {
  recall_he_en: 'Recognize',
  recall_en_he: 'Recall',
  type_he: 'Type it',
  cloze: 'Cloze',
  form_fs: 'Feminine',
  form_mp: 'Plural (m)',
  form_fp: 'Plural (f)',
};

/**
 * Easiest first, grammar last - the same progression tiers already imply,
 * just made a stable, deliberate menu order instead of leaving it to
 * whatever order the cards happen to come back from IndexedDB in.
 */
const TEMPLATE_ORDER: readonly CardTemplate[] = [
  'recall_he_en',
  'recall_en_he',
  'type_he',
  'cloze',
  'form_fs',
  'form_mp',
  'form_fp',
];

export interface PracticeScreenProps {
  lexemes: Lexeme[];
  cards: Map<string, Card>;
  unitTitles: Map<number, string>;
}

/**
 * Practice anything, any time - every word and every card type, with no tier
 * gate and no due-date requirement.
 *
 * This is deliberately not fed through `buildSession`. All 200+ words' cards
 * already exist from day one (see cards.ts), most of them tier-locked or not
 * yet due; running them through the normal queue would blow past the 80-card
 * backlog cap that keeps the *real* due count sane. So every answer here is
 * logged with `countsForScheduling: false`, the same mechanism the Leech Gym
 * uses for its drill repetitions - it counts as practice, never as a review.
 */
export function PracticeScreen({ lexemes, cards, unitTitles }: PracticeScreenProps) {
  const { answer, desiredRetention } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [active, setActive] = useState<{ card: Card; lexeme: Lexeme } | null>(null);

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

  const cardsFor = (lexeme: Lexeme): Card[] =>
    [...cards.values()]
      .filter((c) => c.lexemeId === lexeme.id)
      .sort((a, b) => TEMPLATE_ORDER.indexOf(a.template) - TEMPLATE_ORDER.indexOf(b.template));

  if (active) {
    const { card, lexeme } = active;
    const kind = exerciseFor(card);

    return (
      <div>
        <div className="topbar">
          <button className="pill" onClick={() => setActive(null)}>
            Back
          </button>
          <div className="pill">
            <b>{TEMPLATE_LABELS[card.template]}</b>
          </div>
        </div>

        {kind === 'type' ? (
          <TypeAnswer
            card={card}
            lexeme={lexeme}
            onAnswer={(correct, elapsedMs, usedHint) => {
              void answer({
                cardId: card.id,
                correct,
                usedHint,
                elapsedMs,
                exercise: 'type',
                countsForScheduling: false,
              });
              setActive(null);
            }}
          />
        ) : (
          <Flashcard
            card={card}
            lexeme={lexeme}
            desiredRetention={desiredRetention}
            onAnswer={(rating, elapsedMs) => {
              void answer({
                cardId: card.id,
                rating,
                elapsedMs,
                exercise: kind,
                countsForScheduling: false,
              });
              setActive(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="path">
      <p className="muted">
        Every word, every card type, any time. Practice here never affects scheduling.
      </p>

      {units.map(({ unit, lessons }) => (
        <section key={unit} className="unit">
          <div className="unit-head">
            <h2>{unitTitles.get(unit) ?? `Unit ${unit}`}</h2>
          </div>

          {lessons.map((lesson) => (
            <div key={lesson.title} className="stack" style={{ marginBottom: 14 }}>
              <div className="lesson-label">{lesson.title}</div>

              {lesson.lexemes.map((lexeme) => (
                <div key={lexeme.id}>
                  <button
                    type="button"
                    className="summary-row pressable"
                    onClick={() => setExpandedId(expandedId === lexeme.id ? null : lexeme.id)}
                    aria-expanded={expandedId === lexeme.id}
                  >
                    <Word text={lexeme.lemma} hebrew />
                    <span className="muted">{lexeme.glosses[0]}</span>
                  </button>

                  {expandedId === lexeme.id && (
                    <div className="meta" style={{ padding: '10px 0 14px' }}>
                      {cardsFor(lexeme).map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          className="tag"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setActive({ card, lexeme })}
                        >
                          {TEMPLATE_LABELS[card.template]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
