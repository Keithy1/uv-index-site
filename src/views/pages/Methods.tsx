/**
 * Where the numbers come from, how often, and how wrong they usually are.
 *
 * The accuracy section is the point of this page. A site that publishes a
 * forecast should publish how far off it typically is, and the figures here
 * are the measured ones from validating against ARPANSA — not rounded in our
 * own favour.
 */
import { FORECAST_ACCURACY, REFRESH } from "../../lib/site";
import { Prose } from "../Prose";

export function Methods() {
  const a = FORECAST_ACCURACY;
  return (
    <Prose
      title="Methods: Where uvatlas Gets Its UV Data"
      heading="Methods"
      description={
        "The data sources behind uvatlas, how often each is refreshed, how " +
        "measured readings differ from forecasts, and how accurate the " +
        "forecast has measured out to be."
      }
      path="/methods/"
      updated="25 October 2026"
    >
      <p>
        Every figure on this site comes from one of four sources. This page says
        which, how often it is refreshed, and what is known about its accuracy.
      </p>

      <h2>Sources</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Used for</th>
            <th scope="col">Refreshed</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ARPANSA</td>
            <td>Measured UV at 13 Australian cities</td>
            <td>{REFRESH.arpansa}</td>
          </tr>
          <tr>
            <td>US EPA</td>
            <td>Forecast UV for 50 US cities</td>
            <td>{REFRESH.epa}</td>
          </tr>
          <tr>
            <td>Copernicus (CAMS)</td>
            <td>Forecast curves, tomorrow, sun protection times</td>
            <td>{REFRESH.cams}</td>
          </tr>
          <tr>
            <td>Natural Earth</td>
            <td>Map outlines</td>
            <td>Fixed</td>
          </tr>
        </tbody>
      </table>

      <h2>Measured and forecast</h2>
      <p>
        A <strong>measured</strong> reading comes from an instrument. Australian
        city pages show ARPANSA measurements, taken at the station named on each
        page and republished unaltered.
      </p>
      <p>
        Everything else is a <strong>forecast</strong>: today's curve,
        tomorrow's peak, the sun protection times, and every US figure. The EPA
        publishes no measured feed, so US pages are forecast-only and say so.
      </p>
      <p>
        A measured reading more than 20 minutes old is never presented as the
        level right now. When a station goes quiet the page says the live
        reading is delayed rather than showing a stale number as current.
      </p>

      <h2>How accurate the forecast is</h2>
      <p>
        We compared the forecast against what ARPANSA actually measured, across
        all {a.stations} Australian stations in {a.period} — {a.hours.toLocaleString("en-GB")}{" "}
        paired daylight hours.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Typical error</td>
            <td>{a.meanAbsoluteError} UV index points</td>
          </tr>
          <tr>
            <td>Within 1.0 of measured</td>
            <td>{a.withinOne}% of hours</td>
          </tr>
          <tr>
            <td>Average bias</td>
            <td>+{a.bias} (slightly high)</td>
          </tr>
        </tbody>
      </table>
      <p>
        Accuracy is best in southern cities and worst in the tropics during the
        build-up to the wet season, where afternoon storm cloud is hard for any
        model to place. Almost all the large errors are cloud being
        mis-forecast, not UV being mis-calculated.
      </p>
      <p>
        The forecast model reads about 7% high against these instruments. We
        publish it uncorrected: the offset varies from station to station by
        more than its own size, so a single correction factor would make several
        cities worse rather than better.
      </p>

      <h2>Sun protection times</h2>
      <p>
        These are the hours the UV index is forecast to reach 3 or above, and
        they are calculated from the <strong>clear-sky</strong> forecast — the
        level if no cloud were present.
      </p>
      <p>
        That is deliberate. Cloud can break at any time, and the dangerous error
        is the one that tells you to protect yourself too late. The times are
        therefore conservative, and the page says so wherever they appear. Where
        the forecast does not cover a city's whole day, no times are shown at
        all rather than a boundary being presented as a crossing.
      </p>

      <h2>Bands</h2>
      <p>
        Readings are shown exactly as published, to one decimal place. The band
        — Low, Moderate, High, Very High, Extreme — comes from the reading
        rounded to the nearest whole number, so 2.4 is Low and 2.5 is Moderate.
        The bands are the World Health Organization's.
      </p>

      <h2>Times and time zones</h2>
      <p>
        Every time on the site is local to the city it describes. Queensland,
        the Northern Territory and Western Australia do not observe daylight
        saving while New South Wales, Victoria, South Australia, Tasmania and
        the ACT do, so a single Australian clock would be wrong for roughly half
        the country for half the year.
      </p>

      <h2>Credits and licences</h2>
      <ul>
        <li>
          UV observations courtesy of ARPANSA. © Commonwealth of Australia as
          represented by the Australian Radiation Protection and Nuclear Safety
          Agency.{" "}
          <a href="https://www.arpansa.gov.au/disclaimer" rel="nofollow">
            ARPANSA disclaimer
          </a>
          .
        </li>
        <li>US forecasts: United States Environmental Protection Agency.</li>
        <li>
          Forecast curves and sun protection times contain modified Copernicus
          Atmosphere Monitoring Service information. Neither the European
          Commission nor ECMWF is responsible for any use of this information.
        </li>
        <li>Made with Natural Earth.</li>
      </ul>

      <p class="note">
        Nothing on this site is medical advice. See the{" "}
        <a href="/terms/">terms</a>.
      </p>
    </Prose>
  );
}
