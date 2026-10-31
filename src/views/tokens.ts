/**
 * Every colour, size and step on the site, as CSS custom properties.
 *
 * The one file a hex value may appear in, apart from the WHO band colours in
 * lib/uv.ts, which are a standard and not a design choice. test/tokens.test.ts
 * fails on a hex value anywhere else.
 *
 * The UI palette is cool and quiet on purpose, so the five band colours are
 * the only saturated colour on any page: a reader in glare should find the
 * level by its colour without anything else competing for it. Named for the
 * sky the site is about:
 *
 *   Shade    ink                                  15.3:1 on Sky / 15.1:1
 *   Haze     secondary text                        5.9:1 / 7.4:1
 *   Sky      the page
 *   Cloud    the reading, tables
 *   Zenith   links, focus, selected               8.7:1 / 8.5:1; selected text uses Sky
 *   Horizon  rules and grid lines only, never text
 *
 * Dark mode has its own steps rather than an inversion. It follows the system
 * setting unless the root carries data-theme, so both rules are written twice.
 */
import { BANDS } from "../lib/uv";

const LIGHT = `--shade:#17222E;--haze:#556273;--sky:#F7F9FB;--cloud:#FFFFFF;--zenith:#2B3E9E;
--horizon:#D5DCE4;--wm-uv-a:#d99a0b;--wm-uv-b:#9a6500;--wm-at-a:#4a5260;--wm-at-b:#17222E`;

const DARK = `--shade:#E6ECF2;--haze:#9AA8B8;--sky:#0F1722;--cloud:#182333;--zenith:#9DB0F2;
--horizon:#2A3647;--wm-uv-a:#ffd36b;--wm-uv-b:#e09a00;--wm-at-a:#ffffff;--wm-at-b:#9AA8B8`;

/**
 * The band colours as properties, so a stylesheet can use a band without
 * repeating its hex. Generated from lib/uv.ts: there is one copy of each.
 */
const BAND_PROPS = BANDS.map((b, i) => `--band-${i}:${b.bg}`).join(";");

/**
 * The type scale is 1.25 from a 17 px body. The reading is its own size, 72 px
 * on a phone and 96 px from 620 px up. Spacing steps are 4 8 12 16 24 32 48.
 */
const SCALE = `--t-0:13.6px;--t-1:17px;--t-2:21px;--t-3:26.5px;--t-4:33px;--t-reading:72px;
--s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;--s-7:48px`;

export const TOKENS_CSS = `
:root{color-scheme:light dark;${LIGHT};${BAND_PROPS};${SCALE}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
@media (min-width:620px){:root{--t-reading:96px}}
`;
