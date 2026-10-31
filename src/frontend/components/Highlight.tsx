const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 把文字里命中搜索词的部分标出来；搜索词按空格拆开分别匹配，不分大小写 */
export function Highlight({ text, q }: { text: string; q?: string }) {
  const terms = q?.trim().split(/\s+/).filter(Boolean).map(escape) ?? [];
  if (!terms.length) return <>{text}</>;
  // split 带捕获组时，奇数位就是命中的片段
  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'gi'));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i} className="hl">{p}</mark> : p))}</>;
}
