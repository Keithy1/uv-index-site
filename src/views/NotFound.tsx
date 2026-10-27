/**
 * The page for a URL that is not one.
 *
 * Served with a 404, so it is never indexed; its only job is to get a reader
 * who followed a stale or mistyped link somewhere useful. The countries are
 * listed from the registry rather than written out, so a country going live
 * appears here the same day it appears in the menu.
 */
import { liveCountries } from "../lib/locations";
import { Prose } from "./Prose";

export function NotFound() {
  return (
    <Prose
      title="Page not found"
      heading="That page does not exist"
      description="The page you asked for does not exist. Live UV readings and forecasts are a click away."
      path="/"
    >
      <p>
        The address may be mistyped, or the page may have moved. Everything on
        this site is one of the pages below.
      </p>
      <h2>Live UV by country</h2>
      <ul>
        {liveCountries().map((c) => (
          <li key={c.code}>
            <a href={`/${c.code}/`}>{c.name}</a> — every city's UV now, today's
            peak and tomorrow's forecast
          </li>
        ))}
      </ul>
      <h2>About the UV index</h2>
      <ul>
        <li>
          <a href="/uv-index-explained/">What the UV index numbers mean</a>
        </li>
        <li>
          <a href="/methods/">Where the data comes from</a>
        </li>
      </ul>
    </Prose>
  );
}
