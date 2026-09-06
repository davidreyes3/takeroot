/**
 * Renders a word in the right script and direction.
 *
 * Direction is set here, on the element that actually holds Hebrew, rather
 * than on a container - mixing an English UI with RTL content is exactly where
 * bidi bugs come from, and isolating each run is the fix.
 */

export interface WordProps {
  text: string;
  hebrew: boolean;
  size?: 'prompt' | 'answer' | 'inline';
}

export function Word({ text, hebrew, size = 'inline' }: WordProps) {
  const className = [
    hebrew ? 'he' : '',
    size === 'prompt' ? (hebrew ? 'prompt-he' : 'prompt-en') : '',
    size === 'answer' ? 'answer' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return hebrew ? (
    <bdi className={className} lang="he" dir="rtl">
      {text}
    </bdi>
  ) : (
    <span className={className} lang="en">
      {text}
    </span>
  );
}
