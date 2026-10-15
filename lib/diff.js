const normalize = (text) => text.replace(/\r\n/g, '\n').replace(/\n$/, '');

export const splitLines = (text) => normalize(text).split('\n');

/** 'new' (no file yet), 'same' or 'differs'. */
export function fileState(file) {
  if (file.existing == null) return 'new';
  return normalize(file.existing) === normalize(file.content) ? 'same' : 'differs';
}

/** Indexes of the lines of `a` and `b` that fall outside their longest common subsequence (the changed lines). */
export function changedLines(a, b) {
  const gone = new Set();
  const added = new Set();
  if (a.length * b.length > 4e6) return { gone, added };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) gone.add(i++);
    else added.add(j++);
  }
  while (i < a.length) gone.add(i++);
  while (j < b.length) added.add(j++);
  return { gone, added };
}
