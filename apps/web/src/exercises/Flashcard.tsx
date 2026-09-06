import { useEffect, useRef, useState } from 'react';
import { createScheduler, previewIntervals, type Card, type Lexeme, type Rating } from '@lang/core';
import { cardFace } from '../face.js';
import { Word } from '../components/Word.js';

const RATING_LABELS: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

function formatDue(days: number): string {
  if (days < 1 / 24) return `${Math.max(1, Math.round(days * 24 * 60))}m`;
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export interface FlashcardProps {
  card: Card;
  lexeme: Lexeme;
  desiredRetention: number;
  onAnswer: (rating: Rating, elapsedMs: number) => void;
}

/**
 * The self-graded flashcard: the one exercise where the learner, not a
 * heuristic, judges the recall. Kept as the backbone of the app because it is
 * the only format where "I knew it but slowly" can be reported honestly.
 */
export function Flashcard({ card, lexeme, desiredRetention, onAnswer }: FlashcardProps) {
  const [revealed, setRevealed] = useState(false);
  const shownAt = useRef(Date.now());
  const face = cardFace(lexeme, card.template);

  useEffect(() => {
    setRevealed(false);
    shownAt.current = Date.now();
  }, [card.id]);

  const intervals = previewIntervals(
    createScheduler({ requestRetention: desiredRetention }),
    card,
    Date.now(),
  );

  const answer = (rating: Rating) => onAnswer(rating, Date.now() - shownAt.current);

  // Keyboard: space reveals, 1-4 rate. Bound on the window so the learner
  // never has to think about focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else answer(3);
        return;
      }
      if (revealed && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        answer(Number(e.key) as Rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, card.id]);

  return (
    <div>
      <div className="card">
        <div className="muted">{face.instruction}</div>
        <Word text={face.prompt} hebrew={face.promptIsHebrew} size="prompt" />

        {revealed && (
          <>
            <div className="divider" />
            <Word text={face.answer} hebrew={face.answerIsHebrew} size="answer" />
            {face.promptIsHebrew && lexeme.translit.value && (
              <div className="translit">{lexeme.translit.value}</div>
            )}
            {face.hint && <div className="muted">{face.hint}</div>}
            {lexeme.mnemonic && (
              <div className="banner calm">
                <b>{lexeme.mnemonic.keyword}</b> — {lexeme.mnemonic.image}
              </div>
            )}
          </>
        )}
      </div>

      {!revealed ? (
        <button className="btn" style={{ marginTop: 18 }} onClick={() => setRevealed(true)}>
          Show answer
        </button>
      ) : (
        <div className="ratings">
          {([1, 2, 3, 4] as const).map((r) => (
            <button key={r} className="rating" data-r={r} onClick={() => answer(r)}>
              <span className="label">{RATING_LABELS[r]}</span>
              <span className="when">{formatDue(intervals[r].days)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
