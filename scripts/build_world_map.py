"""Generate the world map as SVG paths, from Natural Earth.

Built once here, not in the browser: no map library and no GeoJSON ever reach
a visitor. The output is a TypeScript module holding one path per country we
serve or intend to serve, one combined path for everywhere else, and the
projection, so a marker can be placed on exactly the geometry drawn.

Equal Earth (Savric, Patterson & Jenny, 2018) because an equal-area projection
is the honest choice for a world map: Mercator would make the high-latitude
countries we do not serve look enormous and shrink Australia.

Antarctica is dropped. It has no audience, and including it wastes a third of
the vertical space.

    python scripts/build_world_map.py > src/lib/map-world.ts

Natural Earth 1:110m is public domain. The generated file is committed so a
deploy never depends on the network.
"""
from __future__ import annotations

import json
import math
import sys
import urllib.request

SOURCE = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "master/geojson/ne_110m_admin_0_countries.geojson"
)
UA = {"User-Agent": "Mozilla/5.0 (compatible; uvatlas-build/1.0)"}

# Countries the site serves or has a settings entry for. Everything else is
# drawn once, in grey, as a single path.
SERVED = {"AU": "au", "US": "us", "GB": "uk", "CA": "ca", "NZ": "nz"}

# Equal Earth coefficients.
A1, A2, A3, A4 = 1.340264, -0.081106, 0.000893, 0.003796
SQRT3_2 = math.sqrt(3) / 2

WIDTH = 960
PADDING = 4
# Simplification tolerance in projected units. The whole map must stay inside
# the page budget; a world outline is decoration, not a survey.
TOLERANCE = 0.9
# Rings smaller than this are dropped: islands a few pixels across are noise.
MIN_AREA = 2.0


def equal_earth(lon_deg: float, lat_deg: float) -> tuple[float, float]:
    lam = math.radians(lon_deg)
    phi = math.radians(max(-89.9, min(89.9, lat_deg)))
    theta = math.asin(SQRT3_2 * math.sin(phi))
    t2 = theta * theta
    t6 = t2 * t2 * t2
    x = (2 * math.sqrt(3) * lam * math.cos(theta)) / (
        3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)
    )
    y = A4 * t6 * theta**3 + A3 * t6 * theta + A2 * theta**3 + A1 * theta
    return x, y


def fetch_features() -> list[dict]:
    req = urllib.request.Request(SOURCE, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.load(resp)["features"]


def rings(geometry: dict) -> list[list[tuple[float, float]]]:
    if geometry["type"] == "Polygon":
        return [[(x, y) for x, y in geometry["coordinates"][0]]]
    return [[(x, y) for x, y in poly[0]] for poly in geometry["coordinates"]]


def simplify(ring, tolerance: float):
    if len(ring) < 3:
        return ring

    def distance(p, a, b) -> float:
        if a == b:
            return math.dist(p, a)
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        return math.dist(p, (a[0] + t * dx, a[1] + t * dy))

    first, last = ring[0], ring[-1]
    worst, index = 0.0, 0
    for i in range(1, len(ring) - 1):
        d = distance(ring[i], first, last)
        if d > worst:
            worst, index = d, i
    if worst <= tolerance:
        return [first, last]
    return simplify(ring[: index + 1], tolerance)[:-1] + simplify(ring[index:], tolerance)


def area(ring) -> float:
    total = 0.0
    for i in range(len(ring) - 1):
        total += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(total) / 2


def main() -> int:
    features = fetch_features()

    projected: dict[str, list[list[tuple[float, float]]]] = {}
    others: list[list[tuple[float, float]]] = []

    for feature in features:
        props = feature.get("properties", {})
        iso = props.get("ISO_A2") or props.get("ISO_A2_EH") or ""
        name = props.get("NAME", "")
        if name == "Antarctica" or iso == "AQ":
            continue
        shapes = [[equal_earth(lon, lat) for lon, lat in ring] for ring in rings(feature["geometry"])]
        if iso in SERVED:
            projected.setdefault(iso, []).extend(shapes)
        else:
            others.extend(shapes)

    everything = [r for rs in projected.values() for r in rs] + others
    xs = [p[0] for r in everything for p in r]
    ys = [p[1] for r in everything for p in r]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    scale = (WIDTH - 2 * PADDING) / (max_x - min_x)
    height = round((max_y - min_y) * scale + 2 * PADDING)

    def to_view(point: tuple[float, float]) -> tuple[float, float]:
        x, y = point
        return (
            round(PADDING + (x - min_x) * scale, 1),
            round(PADDING + (max_y - y) * scale, 1),
        )

    def to_path(shapes) -> str:
        out = []
        for ring in shapes:
            view = [to_view(p) for p in ring]
            view = simplify(view, TOLERANCE)
            if len(view) < 4 or area(view) < MIN_AREA:
                continue
            out.append("M" + " L".join(f"{x},{y}" for x, y in view) + " Z")
        return " ".join(out)

    served_paths = {SERVED[iso]: to_path(shapes) for iso, shapes in projected.items()}
    other_path = to_path(others)

    entries = ",\n".join(f'  {code}: "{path}"' for code, path in sorted(served_paths.items()))
    out = f'''/**
 * World map, generated by scripts/build_world_map.py from Natural Earth 1:110m
 * (public domain). Do not edit by hand -- re-run the script.
 *
 * Equal Earth projection: an equal-area world map is the honest choice here,
 * since Mercator would inflate the countries we do not serve and shrink
 * Australia, which is the one we do. Antarctica is omitted; it has no audience
 * and would cost a third of the vertical space.
 */
export const WORLD_WIDTH = {WIDTH};
export const WORLD_HEIGHT = {height};

/** Every country we do not serve, as one path. Drawn once, in grey. */
export const OTHER_COUNTRIES_PATH =
  "{other_path}";

/** Served countries, keyed by the country code used throughout the site. */
export const COUNTRY_PATHS: Record<string, string> = {{
{entries}
}};

const MIN_X = {min_x:.10f};
const MAX_Y = {max_y:.10f};
const SCALE = {scale:.6f};
const PADDING = {PADDING};
const A1 = {A1}, A2 = {A2}, A3 = {A3}, A4 = {A4};
const SQRT3_2 = Math.sqrt(3) / 2;

/** Latitude and longitude to a point in the viewBox, via Equal Earth. */
export function projectWorld(lat: number, lon: number): {{ x: number; y: number }} {{
  const lam = (lon * Math.PI) / 180;
  const phi = (Math.max(-89.9, Math.min(89.9, lat)) * Math.PI) / 180;
  const theta = Math.asin(SQRT3_2 * Math.sin(phi));
  const t2 = theta * theta;
  const t6 = t2 * t2 * t2;
  const x =
    (2 * Math.sqrt(3) * lam * Math.cos(theta)) /
    (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = A4 * t6 * theta ** 3 + A3 * t6 * theta + A2 * theta ** 3 + A1 * theta;
  return {{
    x: PADDING + (x - MIN_X) * SCALE,
    y: PADDING + (MAX_Y - y) * SCALE,
  }};
}}
'''
    sys.stdout.write(out)
    total = len(other_path) + sum(len(p) for p in served_paths.values())
    print(f"// served: {sorted(served_paths)}, path chars: {total:,}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
