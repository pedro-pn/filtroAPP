// Build the JSON row returned by PostgreSQL, including its unzoned timestamps.
export function costReferenceRows({ roles = [], profiles = [], settings = [] } = {}) {
  return [{ roles, settings, profiles: profiles.map(profile => ({ ...profile,
    parameterSets: profile.parameterSets.map(set => ({ ...set,
      effectiveDate: new Date(set.effectiveDate).toISOString().slice(0, 10),
      createdAt: new Date(set.createdAt ?? 0).toISOString().replace(/Z$/, '')
    }))
  })) }];
}
