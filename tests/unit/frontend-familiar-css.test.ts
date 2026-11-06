import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// familiar.css 是全局引入的。没带 fq- 前缀的规则会打到全站同名元素上：
// 这样的 .sleeve、.tracks 曾把主页封面和歌曲列表弄坏，所以这里卡住命名。
const read = (name: string) => readFileSync(`src/frontend/styles/${name}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const familiar = read("familiar.css");

// 这些是有意给 MemberApply、AdminMembership 补的样式，选择器精确到对应元素。
const SHARED = new Set([".madmin-lanes", ".madmin-status.q-active", ".madmin-status.q-disabled", ".madmin-status.q-retired", ".apply-more"]);

function selectors(css: string): string[] {
  const found: string[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === "}") start = i + 1;
    if (css[i] !== "{") continue;
    const prelude = css.slice(start, i).trim();
    start = i + 1;
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) continue;
    if (prelude.startsWith("@")) {
      i = closing(css, i);
      start = i + 1;
      continue;
    }
    found.push(...prelude.split(",").map((s) => s.trim()));
    i = closing(css, i);
    start = i + 1;
  }
  return found;
}

function closing(css: string, open: number): number {
  let depth = 1;
  let i = open + 1;
  for (; depth > 0; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
  }
  return i - 1;
}

const keyframes = (css: string) => [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);

describe("familiar.css 不外溢", () => {
  it("解析得到规则", () => {
    expect(selectors(familiar).length).toBeGreaterThan(300);
  });

  it("每条选择器都带 fq 或 fadmin 作用域", () => {
    const leaked = selectors(familiar).filter((s) => !/\.(fq|fadmin)(-[\w-]+)?(?![\w-])/.test(s) && !SHARED.has(s));
    expect(leaked).toEqual([]);
  });

  it("动画名不和全站样式重名", () => {
    const site = new Set([...keyframes(read("app.css")), ...keyframes(read("motion.css"))]);
    expect(keyframes(familiar).filter((name) => site.has(name))).toEqual([]);
  });
});
