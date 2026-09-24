import { useMemo } from 'react';
import type { Card, Lexeme, Rating, SessionPlan } from '@lang/core';
import { useApp, advance } from '../store.js';
import { Flashcard } from '../exercises/Flashcard.js';
import { TypeAnswer } from '../exercises/TypeAnswer.js';
import { GymRunner } from '../exercises/GymRunner.js';
import { Word } from '../components/Word.js';

export interface SessionScreenProps {
  plan: SessionPlan;
  cursor: number;
  cards: Map<string, Card>;
  lexemes: Lexeme[];
  onFinish: () => void;
}

export function SessionScreen({ plan, cursor, cards, lexemes, onFinish }: SessionScreenProps) {
  const lexemeById = useMemo(() => new Map(lexemes.map((l) => [l.id, l])), [lexemes]);
  const { answer, saveMnemonic, desiredRetention, sessionResults } = useApp();

  const item = plan.items[cursor];

  if (!item) return <Summary results={sessionResults} lexemeById={lexemeById} onFinish={onFinish} />;

  const card = cards.get(item.cardId);
  const lexeme = lexemeById.get(item.lexemeId);

  if (!card || !lexeme) {
    // Content changed underneath us; skip rather than crash.
    advance();
    return null;
  }

  const next = () => {
    if (!advance()) {
      // Cursor has run past the end; the summary renders on the next pass.
    }
  };

  const total = plan.items.length;
  const header = (
    <div className="session-top">
      <button className="icon-btn" onClick={onFinish} aria-label="Leave">
        <svg viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      {/* One segment per card while they still fit a phone's width; past
          that, a single bar says the same thing without turning to hairlines. */}
      <div className="session-progress" aria-hidden="true" data-segmented={total <= 20}>
        {total <= 20 ? (
          plan.items.map((it, i) => <span key={it.cardId + i} data-state={i < cursor ? 'done' : i === cursor ? 'now' : 'todo'} />)
        ) : (
          <span data-state="done" style={{ width: `${(cursor / total) * 100}%` }} />
        )}
      </div>
      <div className="session-count">
        <b>{cursor + 1}</b>/{total}
      </div>
    </div>
  );

  if (item.kind === 'gym' && item.gymPlan) {
    return (
      <>
        {header}
        <GymRunner
          plan={item.gymPlan}
          cards={cards}
          lexemes={lexemeById}
          desiredRetention={desiredRetention}
          onDrillAnswer={(cardId, rating, elapsedMs) => {
            void answer({
              cardId,
              rating,
              elapsedMs,
              exercise: 'flashcard',
              countsForScheduling: false,
            });
          }}
          onFinalAnswer={(cardId, correct, elapsedMs, usedHint) => {
            void answer({ cardId, correct, usedHint, elapsedMs, exercise: 'type' });
          }}
          onFinalRating={(cardId, rating, elapsedMs) => {
            void answer({ cardId, rating, elapsedMs, exercise: 'flashcard' });
          }}
          onSaveMnemonic={(lexemeId, keyword, image) => {
            void saveMnemonic(lexemeId, keyword, image);
          }}
          onComplete={next}
        />
      </>
    );
  }

  if (item.exercise === 'type') {
    return (
      <>
        {header}
        <TypeAnswer
          card={card}
          lexeme={lexeme}
          onAnswer={(correct, elapsedMs, usedHint) => {
            void answer({ cardId: card.id, correct, usedHint, elapsedMs, exercise: 'type' });
            next();
          }}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <div className="session-kind">
        <span className="chip" data-kind={item.kind}>
          {item.kind === 'new' ? 'New word' : 'Review'}
        </span>
      </div>
      <Flashcard
        card={card}
        lexeme={lexeme}
        desiredRetention={desiredRetention}
        onAnswer={(rating, elapsedMs) => {
          void answer({ cardId: card.id, rating, elapsedMs, exercise: item.exercise });
          next();
        }}
      />
    </>
  );
}

function Summary({
  results,
  lexemeById,
  onFinish,
}: {
  results: { lexemeId: string; rating: Rating }[];
  lexemeById: Map<string, Lexeme>;
  onFinish: () => void;
}) {
  const struggled = results.filter((r) => r.rating <= 2);

  return (
    <div className="stack">
      <h1 className="done-title">Session done</h1>

      <div className="tiles" data-count="2">
        <div className="tile">
          <div className="tile-value">{results.length}</div>
          <div className="tile-label">reviewed</div>
        </div>
        <div className="tile">
          <div className="tile-value">
            {results.length === 0
              ? '—'
              : `${Math.round((results.filter((r) => r.rating > 1).length / results.length) * 100)}%`}
          </div>
          <div className="tile-label">recalled</div>
        </div>
      </div>

      {struggled.length > 0 && (
        <div className="card" style={{ minHeight: 0, alignItems: 'stretch' }}>
          <div className="sheet-label">Coming back sooner</div>
          {struggled.map((r, i) => {
            const lexeme = lexemeById.get(r.lexemeId);
            if (!lexeme) return null;
            return (
              <div key={`${r.lexemeId}-${i}`} className="summary-row">
                <div className="row">
                  <span className="dot" data-r={r.rating} />
                  <Word text={lexeme.lemma} hebrew />
                </div>
                <span className="muted">{lexeme.glosses[0]}</span>
              </div>
            );
          })}
        </div>
      )}

      <button className="btn" onClick={onFinish}>
        Back to the path
      </button>
    </div>
  );
}
