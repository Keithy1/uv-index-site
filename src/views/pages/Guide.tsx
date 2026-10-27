/**
 * The UV index explained.
 *
 * Written by hand, not generated, and every factual claim here is one of the
 * standard positions held by WHO, ARPANSA or the US EPA. Where a number is
 * approximate the text says so, because a confident wrong figure on a health
 * page is worse than a hedged right one.
 *
 * Deliberately NOT here: anything that reads as personal medical advice,
 * vitamin D dosing, or a claim about a particular skin condition. The page
 * gives the public-health guidance those agencies give, and says plainly that
 * it is not a substitute for a doctor.
 */
import { BANDS } from "../../lib/uv";
import { Prose } from "../Prose";

export function Guide() {
  return (
    <Prose
      title="UV Index Explained: What the Numbers Mean and When to Cover Up"
      heading="The UV index explained"
      description={
        "What the UV index measures, what each level means, and why cloud, " +
        "altitude and reflection change it. Plain-English guidance from WHO, " +
        "ARPANSA and EPA positions."
      }
      path="/uv-index-explained/"
      updated="27 October 2026"
    >
      <p>
        What is the UV index? A single number describing how strong the sun's
        ultraviolet radiation is at ground level, at a particular place and
        moment. It starts at 0 and has no fixed upper limit, though readings
        above 16 are rare outside the tropics and high altitude.
      </p>
      <p>
        It was designed to be acted on rather than understood: the higher the
        number, the less time unprotected skin can be exposed before it is
        damaged. The scale is standardised internationally, so a UV index of 8
        means the same in Perth as it does in Phoenix.
      </p>

      <h2>The UV index scale</h2>
      <p>
        The World Health Organization groups the index into five bands. The
        colours below are the ones used throughout this site.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Index</th>
            <th scope="col">Band</th>
            <th scope="col">What to do</th>
          </tr>
        </thead>
        <tbody>
          {BANDS.map((band, i) => {
            const low = i === 0 ? 0 : (BANDS[i - 1]!.max as number) + 1;
            const range = band.max === null ? `${low}+` : `${low}–${band.max}`;
            return (
              <tr key={band.name}>
                <td>{range}</td>
                <td>
                  <span class="band" style={`background:${band.bg};color:${band.fg}`}>
                    {band.name}
                  </span>
                </td>
                <td>{band.advice}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        Sun protection is generally advised whenever the index reaches 3 or
        above. That threshold is the basis of the sun protection times shown on
        every city page.
      </p>

      <h2>You cannot feel it</h2>
      <p>
        This is the point most worth remembering. UV is not heat and not light,
        so there is nothing to warn you about it. A cool, breezy, overcast
        spring day can carry a higher UV index than a sweltering afternoon in
        late summer, and skin burns just as readily on it.
      </p>
      <p>
        Temperature is a particularly poor guide in Australia, where the UV
        index routinely reaches Very High or Extreme in September and October
        while the air is still mild.
      </p>

      <h2>What changes the UV index</h2>

      <h3>Time of day and year</h3>
      <p>
        The dominant factor is how high the sun sits in the sky. UV peaks around
        solar noon — which is not the same as midday on the clock, and is an
        hour off wherever daylight saving is in force. It rises and falls
        steeply either side, so the middle of the day carries most of the day's
        total exposure.
      </p>

      <h3>Latitude</h3>
      <p>
        UV is strongest near the equator and weakens towards the poles. Darwin
        sits at about 12° south and sees Extreme readings for much of the year;
        Hobart at about 43° south rarely exceeds Very High even in midsummer.
      </p>

      <h3>Cloud</h3>
      <p>
        Cloud reduces UV, but much less reliably than people expect. Thin or
        broken cloud may cut it only slightly, and scattered cloud can briefly
        <em> increase</em> it above the clear-sky level by reflecting additional
        radiation towards the ground. Only thick, continuous cloud reduces UV
        substantially.
      </p>
      <p class="note">
        This is why the sun protection times on this site are calculated from
        the clear-sky forecast. Cloud can break at any time, and advice that is
        wrong in the direction of too little protection is the dangerous kind.
      </p>

      <h3>Altitude</h3>
      <p>
        UV increases with height, by roughly 10% for every 1,000 metres of
        elevation, because there is less atmosphere above you to absorb it.
      </p>

      <h3>Reflection</h3>
      <p>
        Surfaces bounce UV back at you, adding to what arrives directly from the
        sky. Fresh snow is by far the strongest reflector and can almost double
        exposure. Dry sand and sea foam reflect appreciably; water, grass and
        soil much less. Shade under a tree or an umbrella therefore reduces UV
        but does not remove it.
      </p>

      <h3>Ozone</h3>
      <p>
        Stratospheric ozone absorbs most incoming UV-B. Natural variation in the
        ozone layer changes surface UV from day to day, and this is part of why
        Australia and New Zealand record higher UV than places at comparable
        latitudes in the northern hemisphere. The Earth also passes closest to
        the sun during the southern summer, which contributes a few per cent
        more.
      </p>

      <h2>Measured and forecast are not the same thing</h2>
      <p>
        A <strong>measured</strong> reading comes from an instrument pointed at
        the sky, reporting what actually reached the ground a few minutes ago.
        Australian city pages on this site show measured readings from ARPANSA.
      </p>
      <p>
        A <strong>forecast</strong> is a model's expectation, and depends on
        getting cloud right, which is the hardest part. Tomorrow's figures,
        today's curve and the sun protection times are forecasts, and are
        labelled as such wherever they appear. The{" "}
        <a href="/methods/">methods page</a> states how accurate ours has
        measured out to be.
      </p>

      <h2>Protecting yourself</h2>
      <p>
        The advice below is the standard public-health guidance of ARPANSA,
        Cancer Council Australia and the US EPA. It applies whenever the index
        is 3 or above.
      </p>
      <ul>
        <li>
          <strong>Clothing</strong> is the most reliable protection: it does not
          wear off or need reapplying. Closely woven fabric covering shoulders
          and back does most of the work.
        </li>
        <li>
          <strong>Sunscreen</strong> of SPF 30 or higher, broad spectrum and
          water resistant. Apply generously about 20 minutes before going out
          and reapply every two hours, and after swimming or towelling. Most
          people apply far less than the amount products are tested with, which
          is the usual reason real-world protection falls short of the label.
        </li>
        <li>
          <strong>A broad-brimmed hat</strong> shades face, neck and ears, which
          caps and visors do not.
        </li>
        <li>
          <strong>Shade</strong>, particularly between mid-morning and
          mid-afternoon — remembering that reflected UV still reaches you.
        </li>
        <li>
          <strong>Sunglasses</strong> meeting a recognised standard. Eyes are
          damaged by UV as skin is, and the damage accumulates.
        </li>
      </ul>
      <p>
        Sunscreen is the least reliable of these on its own, because it depends
        entirely on how much is applied and how often. It works best combined
        with the others rather than instead of them.
      </p>

      <h2>When the index is low</h2>
      <p>
        At 0–2 most people need no protection for ordinary outdoor activity.
        Some sun exposure helps the body make vitamin D, and the amount needed
        varies with skin type, location and season. How much is right for you is
        a question for a doctor, not a website — particularly if you have a
        condition or take medication that affects sun sensitivity.
      </p>

      <h2>Where these figures come from</h2>
      <p>
        Measured Australian readings come from ARPANSA's network of
        instruments. US forecasts come from the Environmental Protection Agency.
        Forecast curves and sun protection times are derived from the Copernicus
        Atmosphere Monitoring Service. The{" "}
        <a href="/methods/">methods page</a> explains each source, how often it
        is refreshed and how accurate it is.
      </p>
      <p class="note">
        This page is general information, not medical advice. If you are
        concerned about your skin, a mole that has changed, or your particular
        risk, speak to a doctor.
      </p>
    </Prose>
  );
}
