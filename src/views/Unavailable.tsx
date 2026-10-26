/**
 * What the site shows when the database will not answer.
 *
 * It had nothing. When D1's free-plan daily row-read allowance ran out, every
 * page that reads data threw, and Hono returned its default: a bare 500 with
 * the words "Internal Server Error" and no markup -- no header, no links, no
 * way on.
 *
 * The text pages stayed up throughout, because they never touch the database,
 * and nothing told the reader they were there. So this page is deliberately a
 * page: the header, the footer, an honest sentence about what is missing, and
 * links to the parts that still work. A reader who wanted to know whether to
 * put a hat on can still reach the guide.
 */
import { Prose } from "./Prose";

export function Unavailable() {
  return (
    <Prose
      title="UV readings are temporarily unavailable"
      heading="Readings are temporarily unavailable"
      description="The live UV readings could not be loaded. The guide and the methods page are unaffected."
      path="/"
    >
      <p>
        Something went wrong fetching the readings, so this page cannot show a UV
        level right now. Nothing is wrong with your connection, and there is
        nothing to do but try again shortly.
      </p>
      <p>
        We would rather say this plainly than show a number we are not sure of. A
        stale reading looks exactly like a current one, and on a day of Extreme
        UV that is the one mistake this site must not make.
      </p>
      <h2>Still available</h2>
      <ul>
        <li>
          <a href="/uv-index-explained/">What the UV index numbers mean</a> — the
          bands, what changes them, and what to do at each level.
        </li>
        <li>
          <a href="/methods/">Methods</a> — where the data comes from and how
          often each source is refreshed.
        </li>
      </ul>
      <p class="note">
        If this persists, the status of every source is published at{" "}
        <a href="/api/health">/api/health</a>.
      </p>
    </Prose>
  );
}
