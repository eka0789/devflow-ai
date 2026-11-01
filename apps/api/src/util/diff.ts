/** Minimal unified-diff generator (LCS based, size-capped). */

const MAX_LINES = 2000;

export function unifiedDiff(path: string, before: string, after: string): string {
  const a = before.length === 0 ? [] : before.split('\n').slice(0, MAX_LINES);
  const b = after.length === 0 ? [] : after.split('\n').slice(0, MAX_LINES);

  // LCS table (capped to avoid pathological memory)
  if (a.length * b.length > 4_000_000) {
    return `--- a/${path}\n+++ b/${path}\n@@ file too large for diff (${a.length} -> ${b.length} lines)`;
  }
  const m = a.length;
  const n = b.length;
  const dp: Uint32Array = new Uint32Array((m + 1) * (n + 1));
  const at = (i: number, j: number): number => i * (n + 1) + j;
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const same = a[i] === b[j];
      const diag = dp[at(i + 1, j + 1)] ?? 0;
      const down = dp[at(i + 1, j)] ?? 0;
      const right = dp[at(i, j + 1)] ?? 0;
      dp[at(i, j)] = same ? diag + 1 : Math.max(down, right);
    }
  }

  // walk to produce edit script
  const ops: Array<{ type: 'same' | 'del' | 'add'; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: 'same', line: a[i]! });
      i++;
      j++;
    } else if ((dp[at(i + 1, j)] ?? 0) >= (dp[at(i, j + 1)] ?? 0)) {
      ops.push({ type: 'del', line: a[i]! });
      i++;
    } else {
      ops.push({ type: 'add', line: b[j]! });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: 'del', line: a[i]! });
    i++;
  }
  while (j < n) {
    ops.push({ type: 'add', line: b[j]! });
    j++;
  }

  if (!ops.some((o) => o.type !== 'same')) return '';

  // emit hunks with 3 lines of context
  const header = `--- a/${path}\n+++ b/${path}`;
  const lines: string[] = [];
  let ai = 0;
  let bi = 0;
  const aLine: number[] = [];
  const bLine: number[] = [];
  for (const op of ops) {
    if (op.type === 'same') {
      ai++;
      bi++;
      aLine.push(ai);
      bLine.push(bi);
    } else if (op.type === 'del') {
      ai++;
      aLine.push(ai);
      bLine.push(bi);
    } else {
      bi++;
      aLine.push(ai);
      bLine.push(bi);
    }
  }

  let idx = 0;
  let emitted = false;
  while (idx < ops.length) {
    if (ops[idx]!.type === 'same') {
      idx++;
      continue;
    }
    // find hunk bounds with context
    let start = idx;
    while (start > 0 && idx - start < 3 && ops[start - 1]!.type === 'same') start--;
    let end = idx;
    while (end < ops.length - 1) {
      if (ops[end + 1]!.type !== 'same') {
        end++;
        continue;
      }
      // look ahead: if another change within 6 lines, extend through context
      let run = 0;
      let k = end + 1;
      while (k < ops.length && ops[k]!.type === 'same') {
        run++;
        k++;
      }
      if (run <= 6 && k < ops.length) {
        end = k - 1;
        continue;
      }
      break;
    }
    const hunkOps = ops.slice(start, end + 1);
    const aStart = aLine[start] ?? 0;
    const bStart = bLine[start] ?? 0;
    const aCount = hunkOps.filter((o) => o.type !== 'add').length;
    const bCount = hunkOps.filter((o) => o.type !== 'del').length;
    lines.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of hunkOps) {
      lines.push((op.type === 'same' ? ' ' : op.type === 'del' ? '-' : '+') + op.line);
    }
    emitted = true;
    idx = end + 1;
  }

  if (!emitted) return '';
  return `${header}\n${lines.join('\n')}`;
}
