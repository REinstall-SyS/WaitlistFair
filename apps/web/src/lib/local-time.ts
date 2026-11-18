// Resolve a minute-precision wall time to its real instants in an IANA zone.
// Current/future IANA UTC offsets are multiples of 15 minutes within +/-14h.
// Zero matches is a clock gap; two matches is a fold requiring a user choice.
export function localInstants(value: string, timezone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const nominal = Date.parse(`${value}:00Z`);
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 16) !== value
  )
    return [];
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matches: string[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = new Date(nominal + offset * 60000);
    const parts = Object.fromEntries(
      formatter.formatToParts(instant).map((p) => [p.type, p.value]),
    );
    const wall = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (wall === value) matches.push(instant.toISOString());
  }
  return matches;
}
