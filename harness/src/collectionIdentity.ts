/** Nexus URL domains and Vortex state game IDs are different identifiers. */
const VORTEX_ID_BY_DOMAIN: Record<string, string> = {
  skyrimspecialedition: "skyrimse",
  newvegas: "falloutnv",
};

const DOMAIN_BY_VORTEX_ID: Record<string, string> = Object.fromEntries(
  Object.entries(VORTEX_ID_BY_DOMAIN).map(([domain, id]) => [id, domain]),
);

export function vortexCollectionGameId(game: string): string {
  const value = game.toLowerCase();
  return VORTEX_ID_BY_DOMAIN[value] ?? value;
}

export function nexusCollectionDomain(game: string): string {
  const value = game.toLowerCase();
  return DOMAIN_BY_VORTEX_ID[value] ?? value;
}
