import { useEffect, useState } from 'react';
import type { Card, SessionPlan } from '@lang/core';
import { useApp } from '../store.js';
import { Word } from '../components/Word.js';
import type { LessonNode } from './PathScreen.js';

export interface LessonPreviewProps {
  node: LessonNode;
  unitTitle: string;
  cards: ReadonlyMap<string, Card>;
  onBack: () => void;
  onStart: () => void;
}

/** How many words to show as a taste of the lesson, not the whole list. */
const SAMPLE_SIZE = 3;

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
    <div className="stack">
      <div className="topbar">
        <button className="pill" onClick={onBack}>
          Back
        </button>
        <div className="pill">
          <b>{node.lexemes.length}</b> words
        </div>
      </div>

      <div>
        <h1 style={{ fontSize: 22, margin: '0 0 2px' }}>{node.title}</h1>
        <div className="muted">{unitTitle}</div>
      </div>

      <div className="meta">
        {node.lexemes.slice(0, SAMPLE_SIZE).map((lexeme) => (
          <span key={lexeme.id} className="tag">
            <Word text={lexeme.lemma} hebrew /> — {lexeme.glosses[0]}
          </span>
        ))}
        {node.lexemes.length > SAMPLE_SIZE && (
          <span className="tag derived">+{node.lexemes.length - SAMPLE_SIZE} more</span>
        )}
      </div>

      <div className="card" style={{ minHeight: 0, gap: 18 }}>
        <div className="row" style={{ justifyContent: 'space-around', width: '100%' }}>
          <Stat label="due" value={due} />
          <Stat label="stuck" value={stuck} alert={stuck !== null && stuck > 0} />
          <Stat label="new" value={notStarted} />
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          {Math.round(node.mastery * 100)}% mastered
          {newThisRound !== null && newThisRound > 0 && (
            <> · {newThisRound} new word{newThisRound === 1 ? '' : 's'} this round</>
          )}
        </div>
      </div>

      <button className="btn" onClick={onStart} disabled={plan !== null && plan.items.length === 0}>
        {plan === null
          ? 'Start'
          : plan.items.length === 0
            ? 'Nothing to study here right now'
            : `Start — ${totalThisRound} card${totalThisRound === 1 ? '' : 's'}`}
      </button>
    </div>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: number | null; alert?: boolean }) {
  return (
    <div className="center">
      <div style={{ fontSize: 28, fontWeight: 700, color: alert ? 'var(--warn)' : undefined }}>
        {value ?? '—'}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}
