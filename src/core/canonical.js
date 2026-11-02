// Stable JSON for content fingerprints and locator provenance.
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function mergeResolutionProfiles(profiles) {
  const merged = {};
  for (const profile of profiles) {
    for (const [key, values] of Object.entries(profile ?? {})) {
      merged[key] = [...new Set([...(merged[key] ?? []), ...values])].sort();
    }
  }
  return merged;
}

// Missing original provenance cannot establish that the same candidates were used.
export function resolutionChanges(original, current) {
  if (!original) return ['provenance-unavailable'];
  return Object.keys(current ?? {}).filter((key) => current[key].some((value) => !(original[key] ?? []).includes(value))).sort();
}
