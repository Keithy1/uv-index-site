/**
 * About, privacy and terms.
 *
 * All three describe what the site actually does, so they are written from the
 * build rather than from a template: no cookies because none are set, no
 * accounts because there are none, and ARPANSA's disclaimer because its
 * licence requires it.
 *
 * Where a detail is genuinely not decided yet — the contact address — the page
 * says so rather than carrying an invented one.
 */
import { CONTACT_EMAIL, PUBLISHER, PUBLISHER_COUNTRY } from "../../lib/site";
import { Prose } from "../Prose";

function Contact() {
  if (CONTACT_EMAIL) {
    return (
      <p>
        Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    );
  }
  return (
    <p class="note">
      A contact address will be published here before the site launches
      properly.
    </p>
  );
}

export function About() {
  return (
    <Prose
      title="About uvatlas"
      heading="About"
      description="Who runs uvatlas, why it exists, and how it is funded."
      path="/about/"
      updated="25 October 2026"
    >
      <p>
        uvatlas publishes the UV index for cities in Australia and the United
        States: what it is right now, how it changes through the day, and when
        sun protection is needed.
      </p>
      <p>
        It exists because UV is the weather measurement you cannot feel. Heat,
        wind and rain announce themselves; ultraviolet does not, and the mild
        spring day that burns you looks exactly like the one that does not. A
        number and a time, on one page, is usually all anyone needs.
      </p>

      <h2>Who runs it</h2>
      <p>
        uvatlas is run by {PUBLISHER}, independently, from {PUBLISHER_COUNTRY}.
        It is not affiliated with ARPANSA, the US Environmental Protection
        Agency, Copernicus, or any health authority. Those organisations provide
        the underlying data under open licences; they have no involvement in
        this site and no responsibility for it.
      </p>
      <Contact />

      <h2>How it is funded</h2>
      <p>
        The site currently carries no advertising and no sponsorship, and sells
        nothing. It may carry advertising in future; if it does, advertisements
        will be clearly separated from the readings, and this page will say so.
      </p>

      <h2>How it is built</h2>
      <p>
        Pages are generated on the server from open data sources, with no
        tracking and almost no JavaScript. The{" "}
        <a href="/methods/">methods page</a> lists every source, how often it is
        refreshed, and how accurate the forecast has measured out to be.
      </p>
    </Prose>
  );
}

export function Privacy() {
  return (
    <Prose
      title="Privacy — uvatlas"
      heading="Privacy"
      description="What uvatlas collects, which is almost nothing: no cookies, no accounts, no tracking."
      path="/privacy/"
      updated="25 October 2026"
    >
      <p>
        Short version: this site sets no cookies, has no accounts, and does not
        track you.
      </p>

      <h2>What is collected</h2>
      <p>
        Nothing you type, because there is nothing to type. There are no forms,
        no sign-ups, and no comments.
      </p>
      <p>
        The site is served through Cloudflare, which processes each request in
        order to deliver the page and to protect the service from abuse. That
        processing involves your IP address and the kind of technical
        information every web server receives. It is not used to build a profile
        of you and is not combined with anything else.
      </p>

      <h2>Cookies</h2>
      <p>
        None are set. If you dismiss the banner suggesting your own country,
        that preference is stored in your browser's local storage, on your
        device. It never leaves it and is not readable by this site's servers.
        Clearing your browsing data removes it.
      </p>

      <h2>Your approximate location</h2>
      <p>
        The home page may offer you your own country. That uses the country code
        Cloudflare attaches to the request, derived from your IP address. It is
        used once, to decide which link to offer, and is not stored or logged by
        this site.
      </p>
      <p>
        The site never asks for precise location, and it never redirects you
        based on where you are — it only offers.
      </p>

      <h2>Third parties</h2>
      <p>
        No advertising networks, no analytics scripts, no social widgets, no
        embedded fonts. External links are marked as such, and this notice does
        not cover what those sites do.
      </p>

      <h2>If this changes</h2>
      <p>
        Should the site ever carry advertising, this notice will be rewritten
        before it does, and visitors in regions that require a consent choice
        will be asked for one.
      </p>
    </Prose>
  );
}

export function Terms() {
  return (
    <Prose
      title="Terms — uvatlas"
      heading="Terms"
      description="Terms of use for uvatlas, including the limits of the data and the ARPANSA disclaimer."
      path="/terms/"
      updated="25 October 2026"
    >
      <h2>Not medical advice</h2>
      <p>
        uvatlas provides general information about ultraviolet radiation levels.
        It is not medical advice and is not a substitute for it. Decisions about
        your health — including sun exposure, skin conditions, and anything
        affecting your sensitivity to sunlight — should be made with a qualified
        professional.
      </p>

      <h2>The data has limits</h2>
      <p>
        Measured readings are republished as the measuring agency provides them.
        Forecasts are model output and are routinely wrong by around one UV
        index point, sometimes more when cloud is mis-forecast; the{" "}
        <a href="/methods/">methods page</a> gives the measured figures.
      </p>
      <p>
        Readings may be delayed, missing, or wrong if a source fails. The site
        marks data as delayed where it can detect it, but no guarantee is made
        that any figure is accurate, current, or available at any given moment.
      </p>
      <p>
        Sun protection times assume clear skies and are intentionally
        conservative. They are a guide, not a guarantee of safety.
      </p>

      <h2>ARPANSA data</h2>
      <p>
        UV observations courtesy of ARPANSA. © Commonwealth of Australia as
        represented by the Australian Radiation Protection and Nuclear Safety
        Agency (ARPANSA). Readings are displayed as published. ARPANSA's own{" "}
        <a href="https://www.arpansa.gov.au/disclaimer" rel="nofollow">
          disclaimer
        </a>{" "}
        applies to that data, and ARPANSA is not responsible for this site or
        for any use made of its data here.
      </p>

      <h2>Other data</h2>
      <p>
        US forecasts are published by the United States Environmental Protection
        Agency. Forecast curves and sun protection times contain modified
        Copernicus Atmosphere Monitoring Service information; neither the
        European Commission nor ECMWF is responsible for any use of that
        information.
      </p>

      <h2>Liability</h2>
      <p>
        The site is provided as it is, without warranties of any kind. To the
        extent permitted by law, {PUBLISHER} accepts no liability for loss or
        harm arising from reliance on anything published here. Nothing in these
        terms limits liability where the law does not permit it to be limited.
      </p>

      <h2>Using what is here</h2>
      <p>
        You are welcome to read, link to, and refer to this site. The underlying
        data belongs to the agencies named above and is subject to their
        licences, which the <a href="/methods/">methods page</a> sets out.
      </p>
    </Prose>
  );
}
