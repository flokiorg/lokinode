import { describe, it, expect } from 'vitest';
import { isNewerVersion } from './version';

describe('isNewerVersion', () => {
  // --- same version ---
  it('returns false when versions are identical', () => {
    expect(isNewerVersion('v0.1.2', 'v0.1.2')).toBe(false);
  });

  it('returns false when versions are identical without v prefix', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
  });

  // --- patch bump ---
  it('returns true when latest has a higher patch', () => {
    expect(isNewerVersion('v0.1.3', 'v0.1.2')).toBe(true);
  });

  it('returns false when latest has a lower patch', () => {
    expect(isNewerVersion('v0.1.1', 'v0.1.2')).toBe(false);
  });

  // --- minor bump ---
  it('returns true when latest has a higher minor', () => {
    expect(isNewerVersion('v0.2.0', 'v0.1.9')).toBe(true);
  });

  it('returns false when latest has a lower minor', () => {
    expect(isNewerVersion('v0.1.0', 'v0.2.0')).toBe(false);
  });

  // --- major bump ---
  it('returns true when latest has a higher major', () => {
    expect(isNewerVersion('v2.0.0', 'v1.9.9')).toBe(true);
  });

  it('returns false when latest has a lower major', () => {
    expect(isNewerVersion('v1.0.0', 'v2.0.0')).toBe(false);
  });

  // --- current is ahead (downgrade scenario) ---
  it('returns false when current is newer than latest (downgrade guard)', () => {
    expect(isNewerVersion('v0.1.2', 'v0.2.0')).toBe(false);
  });

  // --- mixed v prefix ---
  it('handles mixed v prefix gracefully', () => {
    expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.0.1', 'v1.0.0')).toBe(true);
  });

  // --- missing / falsy inputs ---
  it('returns false when latest is undefined', () => {
    expect(isNewerVersion(undefined, 'v0.1.2')).toBe(false);
  });

  it('returns false when current is undefined', () => {
    expect(isNewerVersion('v0.1.3', undefined)).toBe(false);
  });

  it('returns false when both are undefined', () => {
    expect(isNewerVersion(undefined, undefined)).toBe(false);
  });

  it('returns false when latest is empty string', () => {
    expect(isNewerVersion('', 'v0.1.2')).toBe(false);
  });

  it('returns false when current is empty string', () => {
    expect(isNewerVersion('v0.1.3', '')).toBe(false);
  });

  // --- malformed inputs ---
  it('returns false when latest is not a valid semver', () => {
    expect(isNewerVersion('not-a-version', 'v0.1.2')).toBe(false);
  });

  it('returns false when current is not a valid semver', () => {
    expect(isNewerVersion('v0.1.3', 'not-a-version')).toBe(false);
  });

  // --- partial versions ---
  it('handles versions with only major.minor (no patch)', () => {
    expect(isNewerVersion('v1.1', 'v1.0')).toBe(true);
    expect(isNewerVersion('v1.0', 'v1.1')).toBe(false);
  });

  // --- prerelease / RC builds ---
  // A running RC build (e.g. "v0.1.7-rc1") must never be flagged as needing
  // an "update" to an older stable release (e.g. "v0.1.6") just because the
  // strings differ — the numeric core (0.1.7 > 0.1.6) is what matters.
  it('does not flag an RC build as needing "update" to an older stable release', () => {
    expect(isNewerVersion('v0.1.6', 'v0.1.7-rc1')).toBe(false);
  });

  it('does not flag two different prereleases of the same version against each other', () => {
    expect(isNewerVersion('v0.1.7-rc2', 'v0.1.7-rc1')).toBe(false);
    expect(isNewerVersion('v0.1.7-rc1', 'v0.1.7-rc2')).toBe(false);
  });

  it('flags a real update when the stable release of the running RC ships', () => {
    expect(isNewerVersion('v0.1.7', 'v0.1.7-rc1')).toBe(true);
  });

  it('flags a real update when a genuinely newer version ships while on an RC', () => {
    expect(isNewerVersion('v0.1.8', 'v0.1.7-rc1')).toBe(true);
    expect(isNewerVersion('v0.2.0-rc1', 'v0.1.7-rc1')).toBe(true);
  });

  it('does not flag a stable release as needing "update" to its own RC', () => {
    expect(isNewerVersion('v0.1.7-rc1', 'v0.1.7')).toBe(false);
  });
});
