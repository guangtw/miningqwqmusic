import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
const { selectAccountMigrations } = require("../../ops/scripts/account-migrations.cjs");
const hash = (text: string) => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

describe("account deployment migration chain", () => {
  it("selects exact approved migration chains and refuses drift or altered SQL", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "echo-migration-plan-"));
    try {
      fs.mkdirSync(path.join(root, "scripts"));
      const names = ["20261101130000_single_use_memberships", "20261103120000_direct_messages", "20261103160000_rich_direct_messages",
        "20261104120000_membership_applications", "20261105120000_familiar_membership", "20261105130000_familiar_periods", "20261105140000_familiar_question_rules"];
      const scripts = ["migrate-single-use-memberships.mjs", "migrate-direct-messages.mjs", "migrate-rich-direct-messages.mjs",
        "migrate-membership-applications.mjs", "migrate-familiar-membership.mjs", "migrate-familiar-periods.mjs", "migrate-familiar-question-rules.mjs"];
      for (let i = 0; i < names.length; i++) {
        const dir = path.join(root, "prisma/migrations", names[i]); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "migration.sql"), "SELECT 1;");
        fs.writeFileSync(path.join(root, "scripts", scripts[i]), "// fixture");
        fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({ previousSchemaSha256: hash(`schema-${i}`), targetSchemaSha256: hash(`schema-${i + 1}`), migrationSha256: hash("SELECT 1;") }));
      }
      expect(selectAccountMigrations(root, "schema-0", "schema-7").map((x: { name: string }) => x.name)).toEqual(names);
      expect(selectAccountMigrations(root, "schema-6", "schema-7")).toHaveLength(1);
      expect(selectAccountMigrations(root, "schema-5", "schema-6")).toHaveLength(1);
      expect(selectAccountMigrations(root, "schema-4", "schema-5")).toHaveLength(1);
      expect(selectAccountMigrations(root, "schema-3", "schema-4")).toHaveLength(1);
      expect(selectAccountMigrations(root, "schema-1", "schema-3")).toHaveLength(2);
      expect(selectAccountMigrations(root, "schema-2", "schema-3")).toHaveLength(1);
      expect(selectAccountMigrations(root, "schema-3", "schema-3")).toEqual([]);
      expect(() => selectAccountMigrations(root, "unknown", "schema-3")).toThrow("exact approved");
      expect(() => selectAccountMigrations(root, "schema-0", "changed-target")).toThrow("exact approved");
      fs.appendFileSync(path.join(root, "prisma/migrations", names[2], "migration.sql"), "SELECT 2;");
      expect(() => selectAccountMigrations(root, "schema-1", "schema-3")).toThrow("checksum");
    } finally { fs.rmSync(root, { recursive: true }); }
  });
});
