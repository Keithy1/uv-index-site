import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { TOKENS_CSS } from "../src/views/tokens";

/**
 * One file of colours (standards §10): a hex value anywhere but the token file
 * and the WHO bands in lib/uv.ts is a colour nobody will find when the palette
 * changes. The compiled-in images and the font are base64 and are skipped.
 */
const SRC = join(__dirname, "..", "src");
const ALLOWED = new Set(["views/tokens.ts", "lib/uv.ts"]);
// A colour, not an HTML entity (&#39;) or an anchor (#tomorrow).
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("colour tokens", () => {
  it("keeps every hex colour in the token file or the WHO bands", () => {
    const found: string[] = [];
    for (const path of files(SRC)) {
      const rel = relative(SRC, path).replace(/\\/g, "/");
      if (ALLOWED.has(rel) || rel.startsWith("assets/") || !/\.tsx?$/.test(rel)) continue;
      for (const m of readFileSync(path, "utf8").matchAll(HEX)) found.push(`${rel}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });

  it("can tell a colour from an anchor", () => {
    expect("color:#d32010;fill:#fff".match(HEX)).toEqual(["#d32010", "#fff"]);
    expect('href="/au/#tomorrow" &#39; #add-on'.match(HEX)).toBeNull();
  });

  it("defines the six named colours, light and dark, as the design table gives them", () => {
    const light = TOKENS_CSS.match(/:root\{color-scheme[^}]*\}/)![0];
    const dark = TOKENS_CSS.match(/:root\[data-theme="dark"\]\{[^}]*\}/)![0];
    const table: [string, string, string][] = [
      ["shade", "#17222E", "#E6ECF2"],
      ["haze", "#556273", "#9AA8B8"],
      ["sky", "#F7F9FB", "#0F1722"],
      ["cloud", "#FFFFFF", "#182333"],
      ["zenith", "#2B3E9E", "#9DB0F2"],
      ["horizon", "#D5DCE4", "#2A3647"],
    ];
    for (const [name, l, d] of table) {
      expect(light).toContain(`--${name}:${l}`);
      expect(dark).toContain(`--${name}:${d}`);
    }
  });

  it("follows the system's dark setting unless the page says otherwise", () => {
    expect(TOKENS_CSS).toMatch(/@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme="light"\]\)\{--shade:#E6ECF2/);
  });
});
