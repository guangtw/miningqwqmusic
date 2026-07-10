/**
 * Display-title line breaking for hero / editorial headlines.
 *
 * Browser `text-wrap: balance` does not understand Chinese phrase boundaries,
 * so titles like "民谣太安静 摇滚太喧嚣 赵雷梁博刚刚好" wrap mid-clause.
 * This packs phrase tokens into balanced lines and only falls back to
 * character-level breaks when there are no natural separators.
 */

export type TitleLineBreakOptions = {
  /** Soft maximum lines (default 2). */
  maxLines?: number;
  /** Soft target characters per line when character-breaking (default 10). */
  targetCharsPerLine?: number;
  /** Hard ceiling per line before forced character split (default 14). */
  maxCharsPerLine?: number;
};

const SEPARATOR = /[|｜/／·•・—–\-～~]+/;
/** Characters that should not start a line (CJK punctuation / closers). */
const NO_LINE_START = /[，。！？、；：,.!?;:）)」』】》〉\]}'"”’]/;
/** Characters that should not end a line alone (openers). */
const NO_LINE_END = /[（(「『【《〈\[{'“‘]/;
/** Prefer not ending a line on these lightweight tails when avoidable. */
const WEAK_LINE_END = /[的了着过地得与和及或而在是有被把让给]/;
const LATIN_WORD = /^[A-Za-z0-9][A-Za-z0-9''&.]*$/;

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

function charWeight(ch: string): number {
  // Full-width / CJK roughly one unit; ASCII half for balance scoring.
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(ch)) return 1;
  if (/[\u3000-\u303f\uff00-\uffef]/.test(ch)) return 1;
  return 0.55;
}

export function measureTitleWidth(text: string): number {
  let total = 0;
  for (const ch of text) total += charWeight(ch);
  return total;
}

/**
 * Split into display phrases:
 * - explicit separators (| · / —) always break
 * - spaces break CJK clauses
 * - consecutive Latin words stay together ("Chill Time")
 */
function splitPhrases(title: string): string[] {
  const rough = title
    .split(SEPARATOR)
    .flatMap((chunk) => chunk.split(/[\s\u3000]+/))
    .map((part) => part.trim())
    .filter(Boolean);

  if (!rough.length) return [title];

  const phrases: string[] = [];
  let latinRun: string[] = [];

  const flushLatin = () => {
    if (!latinRun.length) return;
    phrases.push(latinRun.join(" "));
    latinRun = [];
  };

  for (const part of rough) {
    if (LATIN_WORD.test(part)) {
      latinRun.push(part);
      continue;
    }
    flushLatin();
    phrases.push(part);
  }
  flushLatin();

  return phrases.length ? phrases : [title];
}

function isBadBreak(before: string, after: string): boolean {
  if (!before || !after) return true;
  const end = before[before.length - 1] ?? "";
  const start = after[0] ?? "";
  if (NO_LINE_END.test(end)) return true;
  if (NO_LINE_START.test(start)) return true;
  return false;
}

/**
 * Character-level break for a single long phrase without separators.
 * Prefers balanced lengths and avoids weak / illegal edge characters.
 */
function breakLongPhrase(phrase: string, maxLines: number, targetCharsPerLine: number, maxCharsPerLine: number): string[] {
  const chars = Array.from(phrase);
  if (chars.length <= maxCharsPerLine || maxLines <= 1) {
    return [phrase];
  }

  const total = measureTitleWidth(phrase);
  const linesWanted = Math.min(maxLines, Math.max(2, Math.ceil(total / targetCharsPerLine)));
  const ideal = total / linesWanted;
  const lines: string[] = [];
  let cursor = 0;

  for (let lineIndex = 0; lineIndex < linesWanted - 1; lineIndex += 1) {
    const remainingLines = linesWanted - lineIndex;
    const remaining = chars.slice(cursor);
    if (remaining.length === 0) break;

    const remainingWeight = measureTitleWidth(remaining.join(""));
    const lineIdeal = remainingWeight / remainingLines;

    let bestIndex = cursor + 1;
    let bestScore = Number.POSITIVE_INFINITY;
    let weight = 0;

    for (let i = cursor; i < chars.length - 1; i += 1) {
      weight += charWeight(chars[i]!);
      const nextLen = chars.length - (i + 1);
      if (nextLen < 1) break;
      // Keep enough characters for remaining lines.
      if (nextLen < remainingLines - 1) break;

      const before = chars.slice(cursor, i + 1).join("");
      const after = chars.slice(i + 1).join("");
      if (isBadBreak(before, after)) continue;

      const balance = Math.abs(weight - lineIdeal);
      const weakPenalty = WEAK_LINE_END.test(chars[i]!) ? 0.45 : 0;
      const shortTailPenalty = nextLen === 1 ? 1.2 : nextLen === 2 ? 0.35 : 0;
      const longLinePenalty = weight > maxCharsPerLine ? (weight - maxCharsPerLine) * 0.8 : 0;
      const score = balance + weakPenalty + shortTailPenalty + longLinePenalty;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i + 1;
      }

      // Search a window around the ideal; don't need the whole string every time.
      if (weight > lineIdeal + 3 && bestScore < Number.POSITIVE_INFINITY) break;
    }

    lines.push(chars.slice(cursor, bestIndex).join(""));
    cursor = bestIndex;
  }

  if (cursor < chars.length) {
    lines.push(chars.slice(cursor).join(""));
  }

  return lines.filter(Boolean);
}

/**
 * Pack discrete phrases into up to maxLines, minimizing line-length variance
 * while never splitting a phrase mid-token unless a single phrase is too long.
 */
function packPhrases(phrases: string[], maxLines: number, targetCharsPerLine: number, maxCharsPerLine: number): string[] {
  if (phrases.length <= maxLines) {
    // Expand any single phrase that is still too long.
    return phrases.flatMap((phrase) =>
      measureTitleWidth(phrase) > maxCharsPerLine
        ? breakLongPhrase(phrase, 2, targetCharsPerLine, maxCharsPerLine)
        : [phrase]
    );
  }

  // DP: best variance packing of n phrases into k lines.
  const n = phrases.length;
  const widths = phrases.map((phrase) => measureTitleWidth(phrase));
  // Space joiner cost between phrases on the same line.
  const spaceCost = 0.55;

  const prefix: number[] = [0];
  for (let i = 0; i < n; i += 1) {
    prefix[i + 1] = (prefix[i] ?? 0) + (widths[i] ?? 0);
  }

  const rangeWidth = (i: number, j: number) => {
    // phrases[i..j] inclusive
    const raw = (prefix[j + 1] ?? 0) - (prefix[i] ?? 0);
    const gaps = j - i;
    return raw + gaps * spaceCost;
  };

  const joinRange = (i: number, j: number) => phrases.slice(i, j + 1).join(" ");

  type Cell = { cost: number; prev: number };
  const dp: Cell[][] = Array.from({ length: maxLines + 1 }, () =>
    Array.from({ length: n + 1 }, () => ({ cost: Number.POSITIVE_INFINITY, prev: -1 }))
  );
  dp[0]![0] = { cost: 0, prev: -1 };

  for (let line = 1; line <= maxLines; line += 1) {
    for (let end = line; end <= n; end += 1) {
      for (let start = line - 1; start < end; start += 1) {
        const prevCost = dp[line - 1]![start]?.cost ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(prevCost)) continue;
        const width = rangeWidth(start, end - 1);
        // Soft prefer lines near target; heavy penalty past hard max.
        const overflow = Math.max(0, width - maxCharsPerLine);
        const under = Math.max(0, targetCharsPerLine * 0.55 - width);
        const lineCost = (width - targetCharsPerLine) ** 2 + overflow * 8 + under * 0.6;
        const cost = prevCost + lineCost;
        if (cost < (dp[line]![end]?.cost ?? Number.POSITIVE_INFINITY)) {
          dp[line]![end] = { cost, prev: start };
        }
      }
    }
  }

  // Choose line count with best cost among 1..maxLines that covers all phrases.
  let bestLineCount = 1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let line = 1; line <= maxLines; line += 1) {
    const cost = dp[line]![n]?.cost ?? Number.POSITIVE_INFINITY;
    if (cost < bestCost) {
      bestCost = cost;
      bestLineCount = line;
    }
  }

  const lines: string[] = [];
  let end = n;
  let line = bestLineCount;
  while (line > 0 && end > 0) {
    const start = dp[line]![end]?.prev ?? end - 1;
    lines.unshift(joinRange(start, end - 1));
    end = start;
    line -= 1;
  }

  // Final pass: split any remaining overlong line.
  return lines.flatMap((lineText) =>
    measureTitleWidth(lineText) > maxCharsPerLine + 1 && !lineText.includes(" ")
      ? breakLongPhrase(lineText, 2, targetCharsPerLine, maxCharsPerLine)
      : [lineText]
  );
}

/**
 * Break a display title into balanced visual lines.
 * Returns 1..maxLines strings (no trailing spaces).
 */
export function breakDisplayTitle(title: string, options: TitleLineBreakOptions = {}): string[] {
  const maxLines = Math.max(1, options.maxLines ?? 2);
  const targetCharsPerLine = Math.max(4, options.targetCharsPerLine ?? 10);
  const maxCharsPerLine = Math.max(targetCharsPerLine, options.maxCharsPerLine ?? 14);

  const normalized = normalizeTitle(title);
  if (!normalized) return [];

  if (maxLines === 1) {
    return [normalized];
  }

  const phrases = splitPhrases(normalized);

  if (phrases.length === 1) {
    return breakLongPhrase(phrases[0]!, maxLines, targetCharsPerLine, maxCharsPerLine);
  }

  return packPhrases(phrases, maxLines, targetCharsPerLine, maxCharsPerLine);
}

/**
 * Join broken lines with a newline for plain-text consumers / tests.
 */
export function formatDisplayTitle(title: string, options?: TitleLineBreakOptions): string {
  return breakDisplayTitle(title, options).join("\n");
}
