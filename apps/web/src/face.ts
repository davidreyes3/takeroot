/**
 * What a card actually shows, front and back.
 *
 * Kept out of the components so the six card templates are described in one
 * readable place instead of scattered across JSX branches.
 */

import { SLOT_LABELS, type CardTemplate, type Lexeme } from '@lang/core';

export interface CardFace {
  /** Small line above the prompt telling the learner what is being asked. */
  instruction: string;
  prompt: string;
  promptIsHebrew: boolean;
  answer: string;
  answerIsHebrew: boolean;
  /** Extra context revealed with the answer. */
  hint?: string;
}

export function cardFace(lexeme: Lexeme, template: CardTemplate): CardFace {
  const english = lexeme.glosses.join(', ');
  const base = lexeme.forms.ms?.value ?? lexeme.lemmaBare;

  switch (template) {
    case 'recall_en_he':
      return {
        instruction: 'What is this in Hebrew?',
        prompt: english,
        promptIsHebrew: false,
        answer: lexeme.lemma,
        answerIsHebrew: true,
      };

    case 'type_he':
      return {
        instruction: 'Type it in Hebrew',
        prompt: english,
        promptIsHebrew: false,
        answer: lexeme.lemma,
        answerIsHebrew: true,
      };

    case 'cloze': {
      const example = lexeme.examples[0];
      if (!example) break;
      return {
        instruction: 'Fill in the blank',
        prompt: blankOut(example.he, lexeme),
        promptIsHebrew: true,
        answer: lexeme.lemma,
        answerIsHebrew: true,
        hint: example.en,
      };
    }

    case 'form_fs':
    case 'form_mp':
    case 'form_fp': {
      const slot = template.replace('form_', '') as 'fs' | 'mp' | 'fp';
      const form = lexeme.forms[slot];
      if (!form) break;
      const gloss = lexeme.glosses[0];
      return {
        instruction: `Make it ${SLOT_LABELS[slot]}`,
        prompt: base,
        promptIsHebrew: true,
        answer: form.value,
        answerIsHebrew: true,
        ...(gloss ? { hint: gloss } : {}),
      };
    }

    default:
      break;
  }

  return {
    instruction: 'What does this mean?',
    prompt: lexeme.lemma,
    promptIsHebrew: true,
    answer: english,
    answerIsHebrew: false,
  };
}

/**
 * Replace the target word in an example sentence with a blank.
 *
 * Matches on the unpointed form because example sentences are usually written
 * without niqqud even when the headword carries it.
 */
function blankOut(sentence: string, lexeme: Lexeme): string {
  const target = lexeme.lemmaBare;
  if (target && sentence.includes(target)) return sentence.replace(target, '———');
  return sentence;
}
