import { createRequire } from "node:module";
import { expect, it } from "vitest";
const { normalizeLegacyUnblockSources, setEnvValues } = createRequire(import.meta.url)("../../ops/scripts/music-source-config.cjs");

it("migrates only the obsolete preset, preserving unrelated environment values", () => {
  expect(normalizeLegacyUnblockSources("OTHER=value\r\nMUSIC_SOURCE_UNBLOCK_SOURCES=\"kuwo,kugou,migu\"\r\nTAIL=value\r\n"))
    .toBe("OTHER=value\r\nMUSIC_SOURCE_UNBLOCK_SOURCES=unm,msls,qijieya\r\nTAIL=value\r\n");
  expect(normalizeLegacyUnblockSources("MUSIC_SOURCE_UNBLOCK_SOURCES=custom,kuwo\n")).toBe("MUSIC_SOURCE_UNBLOCK_SOURCES=custom,kuwo\n");
});

it("updates deployment switches while preserving unrelated configuration", () => {
  expect(setEnvValues("KEEP=unchanged\nTRUST=0\nTRUST=0\n", { TRUST: "1", ADDED: "true" }))
    .toBe("KEEP=unchanged\nTRUST=1\nTRUST=1\nADDED=true\n");
  expect(() => setEnvValues("", { TRUST: "true\nOTHER=1" })).toThrow();
});
