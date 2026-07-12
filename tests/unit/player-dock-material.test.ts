import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const globalStyles = readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");

describe("portal player dock material", () => {
  it("keeps the standard backdrop-filter declaration in the production CSS", () => {
    const cssDirectory = path.resolve(process.cwd(), ".next/static/css");
    const cssFiles = existsSync(cssDirectory) ? readdirSync(cssDirectory).filter((fileName) => fileName.endsWith(".css")) : [];
    const builtStyles = cssFiles.length
      ? cssFiles.map((fileName) => readFileSync(path.join(cssDirectory, fileName), "utf8")).join("\n")
      : globalStyles;

    expect(builtStyles).toMatch(/backdrop-filter:\s*blur\(24px\)\s*saturate\(170%\)\s*!important/);
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

  it("keeps playlist drawers on their own opaque material instead of the shared utility glass", () => {
    expect(globalStyles).toMatch(
      /\.immersive-shell \.home-playlist-drawer,\s*\.stage-shell \.home-playlist-drawer,\s*\.home-playlist-drawer[\s\S]*?rgba\(12,\s*17,\s*18,\s*0\.78\)/
    );
    expect(globalStyles).toMatch(
      /:root\[data-theme="light"\] \.immersive-shell \.home-playlist-drawer,\s*:root\[data-theme="light"\] \.stage-shell \.home-playlist-drawer,\s*:root\[data-theme="light"\] \.home-playlist-drawer[\s\S]*?rgba\(238,\s*244,\s*240,\s*0\.78\)/
    );
    expect(globalStyles).not.toMatch(
      /:root\[data-theme="light"\] \.immersive-shell \.home-playlist-drawer,\s*:root\[data-theme="light"\] \.stage-shell \.home-playlist-drawer,\s*:root\[data-theme="light"\] \.immersive-shell \.utility-drawer/
    );
  });
});
