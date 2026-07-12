import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import path from "node:path";

const globalStyles = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");

describe("portal player dock material", () => {
  it("keeps the standard backdrop-filter declaration in the production CSS", () => {
    const cssDirectory = path.resolve(process.cwd(), ".next/static/css");
    const builtStyles = readdirSync(cssDirectory)
      .filter((fileName) => fileName.endsWith(".css"))
      .map((fileName) => readFileSync(path.join(cssDirectory, fileName), "utf8"))
      .join("\n");

    expect(builtStyles).toMatch(/(?:^|[;{])backdrop-filter:blur\(24px\)saturate\(170%\)!important/);
  });

  it("applies the frosted surface directly to the body portal", () => {
    expect(globalStyles).toMatch(
      /#player-dock-root\s*>\s*\.immersive-player-dock[\s\S]*?background:[\s\S]*?rgba\(10,\s*14,\s*16,\s*0\.38\)[\s\S]*?backdrop-filter:\s*blur\(24px\)\s*saturate\(170%\)[\s\S]*?-webkit-backdrop-filter:\s*blur\(24px\)\s*saturate\(170%\)/
    );
  });

  it("gives account, settings, and login panels a shell-independent frosted surface", () => {
    expect(globalStyles).toMatch(
      /\.utility-drawer,\s*\.account-dialog-panel,\s*\.stage-auth-panel[\s\S]*?background:[\s\S]*?backdrop-filter:\s*blur\(22px\)\s*saturate\(170%\)[\s\S]*?-webkit-backdrop-filter:\s*blur\(22px\)\s*saturate\(170%\)/
    );
  });
});
