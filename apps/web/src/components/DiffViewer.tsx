/** Unified diff renderer with +/- line coloring and line numbers. */
import type { JSX } from 'react';

interface DiffLine {
  kind: 'file' | 'meta' | 'hunk' | 'add' | 'del' | 'ctx' | 'note';
  text: string;
  oldNo?: number;
  newNo?: number;
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const raw of lines) {
    if (raw.startsWith('diff --git')) {
      const name = /^diff --git a\/(.*) b\/(.*)$/.exec(raw);
      out.push({ kind: 'file', text: name ? name[2]! : raw });
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
      }
      out.push({ kind: 'hunk', text: raw });
      continue;
    }
    if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('index ') || raw.startsWith('new file mode') || raw.startsWith('deleted file mode') || raw.startsWith('similarity index') || raw.startsWith('rename ')) {
      out.push({ kind: 'meta', text: raw });
      continue;
    }
    if (raw.startsWith('\\')) {
      out.push({ kind: 'note', text: raw });
      continue;
    }
    if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), oldNo: undefined, newNo });
      newNo += 1;
      continue;
    }
    if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldNo, newNo: undefined });
      oldNo += 1;
      continue;
    }
    if (raw.startsWith(' ')) {
      out.push({ kind: 'ctx', text: raw.slice(1), oldNo, newNo });
      oldNo += 1;
      newNo += 1;
      continue;
    }
    if (raw === '') continue;
    // context without leading space (some generators)
    out.push({ kind: 'ctx', text: raw, oldNo, newNo });
    oldNo += 1;
    newNo += 1;
  }
  return out;
}

export function DiffViewer({ diff, emptyMessage = 'No changes' }: { diff: string; emptyMessage?: string }): JSX.Element {
  const trimmed = diff.trim();
  if (!trimmed) {
    return <div className="chart-empty">{emptyMessage}</div>;
  }
  const lines = parseUnifiedDiff(diff);

  return (
    <div className="diff" role="figure" aria-label="Code diff">
      {lines.map((line, i) => {
        if (line.kind === 'file') {
          return (
            <div key={i} className="diff-file mono">
              {line.text}
            </div>
          );
        }
        if (line.kind === 'hunk') {
          return (
            <div key={i} className="diff-line diff-hunk">
              {line.text}
            </div>
          );
        }
        if (line.kind === 'meta' || line.kind === 'note') {
          return (
            <div key={i} className="diff-line diff-fileline">
              <span className="diff-sign"> </span>
              <span>{line.text}</span>
            </div>
          );
        }
        const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
        const cls =
          line.kind === 'add' ? 'diff-add' : line.kind === 'del' ? 'diff-del' : '';
        return (
          <div key={i} className={`diff-line ${cls}`}>
            <span className="diff-lineno">{line.oldNo ?? ''}</span>
            <span className="diff-lineno">{line.newNo ?? ''}</span>
            <span className="diff-sign">{sign}</span>
            <span>{line.text || ' '}</span>
          </div>
        );
      })}
    </div>
  );
}
