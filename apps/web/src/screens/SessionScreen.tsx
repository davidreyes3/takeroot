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

  const header = (
    <div className="topbar">
      <button className="pill" onClick={onFinish}>
        Leave
      </button>
      <div className="pill">
        <b>{cursor + 1}</b> / {plan.items.length}
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
      {item.kind === 'new' && <div className="banner calm">New word</div>}
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
      <div className="topbar">
        <h1>Session done</h1>
      </div>

      <div className="card" style={{ minHeight: 0, alignItems: 'stretch' }}>
        <div className="row" style={{ justifyContent: 'space-around', width: '100%' }}>
          <div className="center">
            <div style={{ fontSize: 32, fontWeight: 700 }}>{results.length}</div>
            <div className="muted">reviewed</div>
          </div>
          <div className="center">
            <div style={{ fontSize: 32, fontWeight: 700 }}>
              {results.length === 0
                ? '—'
                : `${Math.round((results.filter((r) => r.rating > 1).length / results.length) * 100)}%`}
            </div>
            <div className="muted">recalled</div>
          </div>
        </div>
      </div>

      {struggled.length > 0 && (
        <div className="card" style={{ minHeight: 0, alignItems: 'stretch' }}>
          <div className="muted" style={{ marginBottom: 4 }}>
            Coming back sooner
          </div>
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
