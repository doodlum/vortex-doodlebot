/** Nexus URL domains and Vortex state game IDs are different identifiers. */
export function vortexCollectionGameId(game: string): string {
  const value = game.toLowerCase();
  return value === "skyrimspecialedition" ? "skyrimse" : value;
}

export function nexusCollectionDomain(game: string): string {
  const value = game.toLowerCase();
  return value === "skyrimse" ? "skyrimspecialedition" : value;
}
