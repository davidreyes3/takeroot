import { useEffect, useMemo, useState } from 'react';
import type { Card, GymPlan, Lexeme, Rating } from '@lang/core';
import { Flashcard } from './Flashcard.js';
import { TypeAnswer } from './TypeAnswer.js';
import { Matching } from './Matching.js';
import { Word } from '../components/Word.js';
import { AgreementTable } from '../components/AgreementTable.js';
import { MnemonicBuilder } from '../components/MnemonicBuilder.js';

export interface GymRunnerProps {
  plan: GymPlan;
  cards: Map<string, Card>;
  lexemes: Map<string, Lexeme>;
  desiredRetention: number;
  /** Drill answers: logged, but never allowed to move the schedule. */
  onDrillAnswer: (cardId: string, rating: Rating, elapsedMs: number) => void;
  /** The one answer that counts. */
  onFinalAnswer: (cardId: string, correct: boolean, elapsedMs: number, usedHint: boolean) => void;
  onSaveMnemonic: (lexemeId: string, keyword: string, image: string) => void;
  onComplete: () => void;
}

/**
 * Walks a struggling word through the escalating gym.
 *
 * The important invariant, enforced by the core and respected here: every step
 * before the final test reports through `onDrillAnswer`, which logs the
 * attempt but leaves FSRS alone. Only the closing typed recall is allowed to
 * reschedule the card.
 */
export function GymRunner(props: GymRunnerProps) {
  const { plan, cards, lexemes, desiredRetention, onComplete } = props;

  // The speed round is specced but not yet built; skipping it keeps the gym
  // coherent rather than crashing on an unhandled step.
  const steps = useMemo(() => plan.steps.filter((s) => s.kind !== 'speed'), [plan]);

  const [stepIndex, setStepIndex] = useState(0);
  const [drillIndex, setDrillIndex] = useState(0);

  useEffect(() => {
    setStepIndex(0);
    setDrillIndex(0);
  }, [plan.targetCardId]);

  const step = steps[stepIndex];
  const targetLexeme = lexemes.get(plan.lexemeId);

  if (!step || !targetLexeme) {
    // Nothing sensible to show; do not strand the learner mid-session.
    onComplete();
    return null;
  }

  const nextStep = () => {
    setDrillIndex(0);
    if (stepIndex + 1 >= steps.length) onComplete();
    else setStepIndex(stepIndex + 1);
  };

  const progress = (
    <>
      <div className="steps" aria-label="Gym progress">
        {steps.map((s, i) => (
          <div key={s.kind + i} className="step" data-done={i < stepIndex} data-active={i === stepIndex} />
        ))}
      </div>
      <div className="banner">{step.prompt}</div>
    </>
  );

  if (step.kind === 'study') {
    return (
      <div>
        {progress}
        <div className="card">
          <Word text={targetLexeme.lemma} hebrew size="prompt" />
          {targetLexeme.translit.value && <div className="translit">{targetLexeme.translit.value}</div>}
          <div className="divider" />
          <Word text={targetLexeme.glosses.join(', ')} hebrew={false} size="answer" />
          {targetLexeme.mnemonic && (
            <div className="banner calm">
              <b>{targetLexeme.mnemonic.keyword}</b> — {targetLexeme.mnemonic.image}
            </div>
          )}
          <AgreementTable lexeme={targetLexeme} />
        </div>
        <button className="btn" style={{ marginTop: 18 }} onClick={nextStep}>
          Got it, drill me
        </button>
      </div>
    );
  }

  if (step.kind === 'mnemonic') {
    return (
      <div>
        {progress}
        <MnemonicBuilder
          lexeme={targetLexeme}
          onSave={(keyword, image) => {
            props.onSaveMnemonic(targetLexeme.id, keyword, image);
            nextStep();
          }}
          onSkip={nextStep}
        />
      </div>
    );
  }

  if (step.kind === 'drill') {
    const cardId = step.sequence[drillIndex];
    const card = cardId ? cards.get(cardId) : undefined;
    const lexeme = card ? lexemes.get(card.lexemeId) : undefined;

    if (!card || !lexeme) {
      nextStep();
      return null;
    }

    return (
      <div>
        {progress}
        <div className="muted center" style={{ marginBottom: 10 }}>
          {drillIndex + 1} of {step.sequence.length}
        </div>
        <Flashcard
          key={`${cardId}-${drillIndex}`}
          card={card}
          lexeme={lexeme}
          desiredRetention={desiredRetention}
          onAnswer={(rating, elapsedMs) => {
            props.onDrillAnswer(card.id, rating, elapsedMs);
            if (drillIndex + 1 >= step.sequence.length) nextStep();
            else setDrillIndex(drillIndex + 1);
          }}
        />
      </div>
    );
  }

  if (step.kind === 'matching') {
    const poolLexemes = step.sequence
      .slice(1)
      .map((id) => cards.get(id))
      .map((c) => (c ? lexemes.get(c.lexemeId) : undefined))
      .filter((l): l is Lexeme => l !== undefined && l.id !== targetLexeme.id);

    if (poolLexemes.length < 2) {
      nextStep();
      return null;
    }

    return (
      <div>
        {progress}
        <Matching target={targetLexeme} pool={poolLexemes} onDone={nextStep} />
      </div>
    );
  }

  // final_test
  const finalCard = cards.get(plan.targetCardId);
  if (!finalCard) {
    onComplete();
    return null;
  }

  return (
    <div>
      {progress}
      <TypeAnswer
        card={finalCard}
        lexeme={targetLexeme}
        onAnswer={(correct, elapsedMs, usedHint) => {
          props.onFinalAnswer(finalCard.id, correct, elapsedMs, usedHint);
          onComplete();
        }}
      />
    </div>
  );
}
