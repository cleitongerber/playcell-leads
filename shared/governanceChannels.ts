/**
 * Operational channels supported by the unified lead journey.
 *
 * These are policy keys, rather than display labels. Keeping this compact
 * catalogue shared prevents the governance UI from accepting an arbitrary
 * string that the operational journey cannot reliably use.
 */
export const governanceChannels = [
  { code: "whatsapp", label: "WhatsApp" },
  { code: "ligação", label: "Ligação" },
] as const;

export const governanceChannelCodes = governanceChannels.map(
  channel => channel.code
);
