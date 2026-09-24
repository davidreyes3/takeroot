import { useEffect, useState } from 'react';
import type { Card, SessionPlan } from '@lang/core';
import { useApp } from '../store.js';
import { Word } from '../components/Word.js';
import { lessonStage, progressRing, type LessonNode } from './PathScreen.js';

export interface LessonPreviewProps {
  node: LessonNode;
  unitTitle: string;
  cards: ReadonlyMap<string, Card>;
  onBack: () => void;
  onStart: () => void;
}

/**
 * What tapping a lesson is actually going to ask of you, before you commit
 * to it.
 *
 * This exists because the single global "Study" button was the actual
 * problem behind a backlog that never stopped growing: it pulled from every
 * lesson's due cards at once, so studying "Family" for five minutes could
 * mean seeing "Greetings" words you had no intention of touching today, and
 * the whole course's backlog felt like one thing you could never finish.
 * Session content is already properly scoped per lesson (`startSession`
 * takes `lexemeIds`); what was missing was a UI that only ever offered you
 * one lesson at a time, and told you what was in it before you started.
 */
export function LessonPreview({ node, unitTitle, cards, onBack, onStart }: LessonPreviewProps) {
  const previewSession = useApp((s) => s.previewSession);
  const [plan, setPlan] = useState<SessionPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlan(null);
    void (async () => {
      const next = await previewSession({ lexemeIds: node.lexemes.map((l) => l.id) });
      if (!cancelled) setPlan(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [node, previewSession]);

  // A word counts as "not started" only once every card it owns is still
  // completely untouched - a word with a graduated recall_he_en but an
  // unlocked, not-yet-seen recall_en_he has begun, even though it still has
  // new cards ahead of it. `stats.newAvailable` from buildSession counts
  // cards, not words, and would overcount here for exactly that reason.
  const notStarted = node.lexemes.filter((lexeme) => {
    const lexemeCards = [...cards.values()].filter((c) => c.lexemeId === lexeme.id);
    return lexemeCards.length > 0 && lexemeCards.every((c) => c.fsrs.state === 0);
  }).length;

  const due = plan ? plan.stats.dueCount - plan.stats.leechCount : null;
  const stuck = plan ? plan.stats.leechCount : null;
  const newThisRound = plan ? plan.items.filter((i) => i.kind === 'new').length : null;
  const totalThisRound = plan?.items.length ?? null;

  return (
    <div className="stack preview">
      <div className="preview-top">
        <button className="back-btn" onClick={onBack}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <span className="muted preview-unit">{unitTitle}</span>
      </div>

      <div className="preview-head">
        <span className="node" data-stage={lessonStage(node)} aria-hidden="true">
          <span
            className="node-ring"
            style={{ background: progressRing(node.mastered, node.learning, node.lexemes.length) }}
          >
            <span className="node-disc">
              <bdi className="he node-word" lang="he" dir="rtl">
                {node.lexemes[0]?.lemma}
              </bdi>
            </span>
          </span>
        </span>
        <div>
          <h1 className="preview-title">{node.title}</h1>
          <div className="legend">
            <span><i data-kind="known" />{node.mastered} known</span>
            <span><i data-kind="learning" />{node.learning} learning</span>
          </div>
        </div>
      </div>

      <div className="tiles">
        <Stat label="due" value={due} />
        <Stat label="stuck" value={stuck} alert={stuck !== null && stuck > 0} />
        <Stat label="new" value={notStarted} />
      </div>
      <div className="muted" style={{ fontSize: 13, marginTop: -4 }}>
        {Math.round(node.mastery * 100)}% mastered
        {newThisRound !== null && newThisRound > 0 && (
          <> · {newThisRound} new word{newThisRound === 1 ? '' : 's'} this round</>
        )}
      </div>

      <ul className="word-sheet">
        {node.lexemes.map((lexeme) => (
          <li key={lexeme.id} className="word-row">
            <span className="dot" data-kind={wordKind(lexeme.id, cards)} aria-hidden="true" />
            <span className="word-row-en">
              <span>{lexeme.glosses[0]}</span>
              {lexeme.translit.value && <span className="translit">{lexeme.translit.value}</span>}
            </span>
            <Word text={lexeme.lemma} hebrew />
          </li>
        ))}
      </ul>

      {/* Held at the bottom of the screen, so the full word list never
          pushes the one thing this screen is for out of reach. */}
      <div className="sticky-action">
        <button className="btn" onClick={onStart} disabled={plan !== null && plan.items.length === 0}>
          {plan === null
            ? 'Start'
            : plan.items.length === 0
              ? 'Nothing to study here right now'
              : `Start — ${totalThisRound} card${totalThisRound === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

/** Same three states as the lesson ring: mastered, answered, or untouched. */
function wordKind(lexemeId: string, cards: ReadonlyMap<string, Card>): 'known' | 'learning' | 'new' {
  if (cards.get(`${lexemeId}:recall_he_en`)?.fsrs.state === 2) return 'known';
  for (const card of cards.values()) {
    if (card.lexemeId === lexemeId && (card.fsrs.state !== 0 || card.fsrs.last_review !== undefined)) return 'learning';
  }
  return 'new';
}

function Stat({ label, value, alert = false }: { label: string; value: number | null; alert?: boolean }) {
  return (
    <div className="tile" data-alert={alert}>
      <div className="tile-value">{value ?? '—'}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
