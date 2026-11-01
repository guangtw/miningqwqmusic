import { createRequire } from "node:module";
import { expect, it } from "vitest";
const { normalizeLegacyUnblockSources } = createRequire(import.meta.url)("../../ops/scripts/music-source-config.cjs");

it("migrates only the obsolete preset, preserving unrelated environment values", () => {
  expect(normalizeLegacyUnblockSources("OTHER=value\r\nMUSIC_SOURCE_UNBLOCK_SOURCES=\"kuwo,kugou,migu\"\r\nTAIL=value\r\n"))
    .toBe("OTHER=value\r\nMUSIC_SOURCE_UNBLOCK_SOURCES=unm,msls,qijieya\r\nTAIL=value\r\n");
  expect(normalizeLegacyUnblockSources("MUSIC_SOURCE_UNBLOCK_SOURCES=custom,kuwo\n")).toBe("MUSIC_SOURCE_UNBLOCK_SOURCES=custom,kuwo\n");
});
