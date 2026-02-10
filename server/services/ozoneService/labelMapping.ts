/**
 * Bidirectional mapping between Coop policy types and Ozone label values.
 *
 * Orgs can configure custom mappings in the `ozone_service.label_mappings`
 * table. When no custom mapping exists, sensible defaults are used.
 */

export type LabelMapping = {
  coopPolicyType: string;
  ozoneLabelValue: string;
  direction: 'INBOUND' | 'OUTBOUND' | 'BOTH';
};

/**
 * Default mapping used when an org has no custom label mappings configured.
 * Maps Coop's PolicyType enum values to Ozone's AT Protocol label vocabulary.
 */
const DEFAULT_MAPPINGS: readonly LabelMapping[] = [
  { coopPolicyType: 'HATE', ozoneLabelValue: 'hate', direction: 'BOTH' },
  {
    coopPolicyType: 'VIOLENCE',
    ozoneLabelValue: 'violence',
    direction: 'BOTH',
  },
  { coopPolicyType: 'VIOLENCE', ozoneLabelValue: 'gore', direction: 'BOTH' },
  {
    coopPolicyType: 'SEXUAL_CONTENT',
    ozoneLabelValue: 'sexual',
    direction: 'BOTH',
  },
  {
    coopPolicyType: 'SEXUAL_CONTENT',
    ozoneLabelValue: 'porn',
    direction: 'BOTH',
  },
  {
    coopPolicyType: 'SEXUAL_CONTENT',
    ozoneLabelValue: 'nudity',
    direction: 'BOTH',
  },
  { coopPolicyType: 'SPAM', ozoneLabelValue: 'spam', direction: 'BOTH' },
  {
    coopPolicyType: 'HARASSMENT',
    ozoneLabelValue: 'harassment',
    direction: 'BOTH',
  },
  {
    coopPolicyType: 'SELF_HARM_AND_SUICIDE',
    ozoneLabelValue: 'self-harm',
    direction: 'BOTH',
  },
  {
    coopPolicyType: 'TERRORISM',
    ozoneLabelValue: 'terrorism',
    direction: 'BOTH',
  },
  {
    coopPolicyType: 'SEXUAL_EXPLOITATION',
    ozoneLabelValue: 'csam',
    direction: 'BOTH',
  },
  {
    coopPolicyType: 'SEXUAL_EXPLOITATION',
    ozoneLabelValue: '!hide',
    direction: 'OUTBOUND',
  },
];

/**
 * Resolve effective mappings: use org-specific mappings if any exist,
 * otherwise fall back to defaults.
 */
export function getEffectiveMappings(
  orgMappings: readonly LabelMapping[],
): readonly LabelMapping[] {
  return orgMappings.length > 0 ? orgMappings : DEFAULT_MAPPINGS;
}

/**
 * Convert Ozone label values to Coop policy type(s).
 * Used when ingesting events from Ozone into Coop.
 */
export function ozoneLabelToCoopPolicies(
  orgMappings: readonly LabelMapping[],
  ozoneLabels: readonly string[],
): string[] {
  const mappings = getEffectiveMappings(orgMappings);
  const inboundMappings = mappings.filter(
    (m) => m.direction === 'INBOUND' || m.direction === 'BOTH',
  );

  const policies = new Set<string>();
  for (const label of ozoneLabels) {
    for (const mapping of inboundMappings) {
      if (mapping.ozoneLabelValue === label) {
        policies.add(mapping.coopPolicyType);
      }
    }
  }
  return [...policies];
}

/**
 * Convert a Coop policy type to Ozone label value(s).
 * Used when emitting events from Coop to Ozone.
 */
export function coopPolicyToOzoneLabels(
  orgMappings: readonly LabelMapping[],
  coopPolicyType: string,
): string[] {
  const mappings = getEffectiveMappings(orgMappings);
  const outboundMappings = mappings.filter(
    (m) => m.direction === 'OUTBOUND' || m.direction === 'BOTH',
  );

  const labels = new Set<string>();
  for (const mapping of outboundMappings) {
    if (mapping.coopPolicyType === coopPolicyType) {
      labels.add(mapping.ozoneLabelValue);
    }
  }
  return [...labels];
}

/**
 * Map an Ozone event $type to a simplified Coop-internal category.
 * Returns null for event types that Coop doesn't act on.
 */
export function ozoneEventTypeToCoopCategory(
  ozoneEventType: string,
): 'REPORT' | 'TAKEDOWN' | 'LABEL' | 'COMMENT' | 'ESCALATE' | null {
  if (ozoneEventType.includes('modEventReport')) return 'REPORT';
  if (ozoneEventType.includes('modEventTakedown')) return 'TAKEDOWN';
  if (ozoneEventType.includes('modEventLabel')) return 'LABEL';
  if (ozoneEventType.includes('modEventComment')) return 'COMMENT';
  if (ozoneEventType.includes('modEventEscalate')) return 'ESCALATE';
  return null;
}
