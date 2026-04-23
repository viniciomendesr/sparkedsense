/**
 * Largest-Triangle-Three-Buckets downsampling.
 *
 * Reduces a dense time-series (thousands of points) to a target count that
 * preserves the visible shape of the line. Used to keep Recharts fast when the
 * historical sensor chart would otherwise have to render 25k+ SVG paths.
 *
 * Algorithm by Sveinn Steinarsson (2013) — https://skemman.is/handle/1946/15343
 * Ported from the canonical JS reference implementation into plain TypeScript.
 */
export type LttbPoint = [number, number]; // [x, y]

export function lttb(points: LttbPoint[], threshold: number): LttbPoint[] {
  const n = points.length;
  if (threshold >= n || threshold < 3) return points.slice();

  const sampled: LttbPoint[] = new Array(threshold);
  let sampledIdx = 0;

  // Bucket size (keep room for first and last points)
  const every = (n - 2) / (threshold - 2);

  let a = 0; // initially the first point is fixed
  sampled[sampledIdx++] = points[a];

  for (let i = 0; i < threshold - 2; i++) {
    // Average point of the next bucket (used to form triangles)
    let avgX = 0;
    let avgY = 0;
    const avgRangeStart = Math.floor((i + 1) * every) + 1;
    let avgRangeEnd = Math.floor((i + 2) * every) + 1;
    if (avgRangeEnd > n) avgRangeEnd = n;
    const avgRangeLength = avgRangeEnd - avgRangeStart;

    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += points[j][0];
      avgY += points[j][1];
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    // Point a is fixed for this iteration; the candidate points are in the bucket
    const rangeOffset = Math.floor(i * every) + 1;
    const rangeTo = Math.floor((i + 1) * every) + 1;

    const pointAx = points[a][0];
    const pointAy = points[a][1];

    let maxArea = -1;
    let nextA = rangeOffset;
    for (let j = rangeOffset; j < rangeTo; j++) {
      // Triangle area between point a, candidate j, and bucket average
      const area = Math.abs(
        (pointAx - avgX) * (points[j][1] - pointAy) -
          (pointAx - points[j][0]) * (avgY - pointAy),
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }

    sampled[sampledIdx++] = points[nextA];
    a = nextA;
  }

  sampled[sampledIdx] = points[n - 1]; // always include last point
  return sampled;
}
