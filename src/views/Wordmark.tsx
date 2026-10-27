/**
 * The UVATLAS wordmark, redrawn as SVG from the logo artwork.
 *
 * Not the artwork itself: cut out as an image, the silver ATLAS is near-white
 * and all but vanishes on the light header, and a raster blurs when scaled.
 * Drawn, it is about 1 KB, sharp at any size, and themed -- gold UV in both,
 * silver ATLAS in dark mode and graphite in light, so it reads on either.
 *
 * The letterforms follow the artwork: a squared U, a sharp V, an A with no
 * crossbar (a lambda, Λ), a squared S. Each letter sits in a 16 x 20 box with
 * 3 between, on a 4.2 stroke -- a first cut at 14 wide and 3.2 thick looked
 * spindly beside the artwork's heavy letters.
 *
 * Decorative to assistive technology: the link that holds it carries the name
 * as real text, for screen readers and search engines.
 */

/** A lambda-style A: no crossbar, as in the artwork. */
const LAMBDA = "M0 20 L5.6 0 H10.4 L16 20 H11.4 L8 7.9 L4.6 20 Z";
const VEE = "M0 0 H4.6 L8 12.1 L11.4 0 H16 L10.4 20 H5.6 Z";

export const WORDMARK_CSS = `
.wordmark{display:block;height:22px;width:auto}
:root{--wm-uv-a:#d99a0b;--wm-uv-b:#9a6500;--wm-at-a:#4a5260;--wm-at-b:#16181d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--wm-uv-a:#ffd36b;--wm-uv-b:#e09a00;--wm-at-a:#ffffff;--wm-at-b:#9aa4b2}}
:root[data-theme="dark"]{--wm-uv-a:#ffd36b;--wm-uv-b:#e09a00;--wm-at-a:#ffffff;--wm-at-b:#9aa4b2}
`;

export function Wordmark() {
  const stroke = { fill: "none", "stroke-width": "4.2", "stroke-linecap": "butt" } as const;
  return (
    <svg class="wordmark" viewBox="-0.5 -0.5 131 21" aria-hidden="true" focusable="false">
      <defs>
        {/* userSpaceOnUse, so strokes and filled shapes shade identically. */}
        <linearGradient id="wm-uv" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="20">
          <stop offset="0" style="stop-color:var(--wm-uv-a)" />
          <stop offset="1" style="stop-color:var(--wm-uv-b)" />
        </linearGradient>
        <linearGradient id="wm-at" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="20">
          <stop offset="0" style="stop-color:var(--wm-at-a)" />
          <stop offset="1" style="stop-color:var(--wm-at-b)" />
        </linearGradient>
      </defs>
      <g stroke="url(#wm-uv)" {...stroke}>
        {/* U */}
        <path d="M2.1 0 V12 A5.9 5.9 0 0 0 13.9 12 V0" />
      </g>
      <path transform="translate(19 0)" d={VEE} fill="url(#wm-uv)" />
      <path transform="translate(38 0)" d={LAMBDA} fill="url(#wm-at)" />
      <g stroke="url(#wm-at)" {...stroke}>
        {/* T */}
        <path d="M57 2.1 H73 M65 2.1 V20" />
        {/* L */}
        <path d="M78.1 0 V17.9 H92" />
        {/* S: two half-rounds joined by straight bars, squared like the artwork's */}
        <path d="M130 2.1 H120.05 A3.95 3.95 0 0 0 120.05 10 H123.95 A3.95 3.95 0 0 1 123.95 17.9 H114" />
      </g>
      <path transform="translate(95 0)" d={LAMBDA} fill="url(#wm-at)" />
    </svg>
  );
}
