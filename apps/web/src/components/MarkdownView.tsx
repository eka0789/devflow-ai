import type { JSX } from 'react';
import { Markdown } from '../lib/markdown';

export function MarkdownView({ source, className }: { source: string; className?: string }): JSX.Element {
  return (
    <div className={className}>
      <Markdown source={source} />
    </div>
  );
}
