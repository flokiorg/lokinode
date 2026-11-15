// Returns true if `latest` is strictly newer than `current`.
// Expects semver-ish tags like "v1.2.3", "1.2.3", or "v1.2.3-rc1"; the
// prerelease suffix (if any) is stripped before the numeric comparison, then
// used only as a tie-breaker when the numeric core is otherwise equal: a
// plain release always outranks a prerelease of the same version (so a
// running RC correctly gets nudged to upgrade once the real release ships),
// but two differently-tagged prereleases of the same version are never
// considered newer than each other — there's nothing safe to infer from
// comparing e.g. "rc2" against "rc1" as arbitrary strings.
// Non-parseable inputs return false.
export function isNewerVersion(latest: string | undefined, current: string | undefined): boolean {
  if (!latest || !current) return false;
  const parse = (v: string) => {
    const [core, ...rest] = v.replace(/^v/, '').split('-');
    return { nums: core.split('.').map(Number), prerelease: rest.join('-') || null };
  };
  const l = parse(latest);
  const c = parse(current);
  if (l.nums.some(isNaN) || c.nums.some(isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const li = l.nums[i] ?? 0;
    const ci = c.nums[i] ?? 0;
    if (li > ci) return true;
    if (li < ci) return false;
  }
  // Numeric core is identical: a plain release outranks a prerelease of the
  // same version.
  if (c.prerelease && !l.prerelease) return true;
  return false;
}
