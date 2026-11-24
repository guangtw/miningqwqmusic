// @vitest-environment node
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { checkReleaseMail } = createRequire(import.meta.url)("../../ops/scripts/release-mail-check.cjs");
let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "echo-mail-check-")); });
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

function setup() {
  const mailFile = path.join(dir, "mail.env");
  fs.writeFileSync(mailFile, "test-only", { mode: 0o600 });
  return { loginDir: dir, loginCommit: "login-a", mailFile, receiptFile: path.join(dir, "receipt.json"),
    verify: vi.fn(() => true), wait: vi.fn(async () => {}) };
}

it("retries authentication and reuses only a successful check across frontend releases", async () => {
  const input = setup();
  input.verify.mockReturnValueOnce(false);
  expect(await checkReleaseMail(input)).toBe("verified");
  expect(input.wait).toHaveBeenCalledWith(15000);
  expect(await checkReleaseMail(input)).toBe("cached");
  expect(input.verify).toHaveBeenCalledTimes(2);
});

it("warns only for recent unchanged credentials and never extends a failed check", async () => {
  const input = setup();
  const now = Date.now();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  await checkReleaseMail(input);
  const receipt = fs.readFileSync(input.receiptFile, "utf8");
  vi.setSystemTime(now + 86400000);
  input.verify.mockReturnValue(false);
  expect(await checkReleaseMail(input)).toBe("auth-warning");
  expect(fs.readFileSync(input.receiptFile, "utf8")).toBe(receipt);
  vi.setSystemTime(now + 7 * 86400000);
  await expect(checkReleaseMail(input)).rejects.toThrow("MAIL_AUTHENTICATION_FAILED");
});

it("requires a live check for a new account commit or changed account or mail configuration", async () => {
  const input = setup();
  await checkReleaseMail(input);
  input.verify.mockReturnValue(false);
  await expect(checkReleaseMail({ ...input, loginCommit: "login-b" })).rejects.toThrow("MAIL_AUTHENTICATION_FAILED");
  fs.writeFileSync(path.join(dir, ".env"), "OTHER=changed");
  await expect(checkReleaseMail(input)).rejects.toThrow("MAIL_AUTHENTICATION_FAILED");
  fs.unlinkSync(path.join(dir, ".env"));
  fs.writeFileSync(input.mailFile, "rotated");
  await expect(checkReleaseMail(input)).rejects.toThrow("MAIL_AUTHENTICATION_FAILED");
  fs.unlinkSync(input.mailFile);
  await expect(checkReleaseMail(input)).rejects.toThrow();
});

it("does not cache failures, unexpected probe errors, or a rotation during verification", async () => {
  const input = setup();
  input.verify.mockReturnValue(false);
  await expect(checkReleaseMail(input)).rejects.toThrow("MAIL_AUTHENTICATION_FAILED");
  input.verify.mockImplementationOnce(() => { throw Error("SMTP_PROBE_FAILED"); });
  await expect(checkReleaseMail(input)).rejects.toThrow("SMTP_PROBE_FAILED");
  input.verify.mockImplementationOnce(() => { fs.writeFileSync(input.mailFile, "rotated"); return true; });
  await expect(checkReleaseMail(input)).rejects.toThrow("SMTP_CONFIGURATION_CHANGED_DURING_CHECK");
  expect(fs.existsSync(input.receiptFile)).toBe(false);
});
