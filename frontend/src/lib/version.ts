// Returns true if `latest` is strictly newer than `current`.
// Expects semver tags like "v1.2.3" or "1.2.3"; non-parseable inputs return false.
export function isNewerVersion(latest: string | undefined, current: string | undefined): boolean {
  if (!latest || !current) return false;
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const l = parse(latest);
  const c = parse(current);
  if (l.some(isNaN) || c.some(isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const li = l[i] ?? 0;
    const ci = c[i] ?? 0;
    if (li > ci) return true;
    if (li < ci) return false;
  }
  return false;
}
