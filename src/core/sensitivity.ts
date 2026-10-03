/**
 * Réglages continus de sensibilité.
 *
 * Les détections gestuelles (gribouillis, reconnaissance de formes) reposent
 * chacune sur une poignée de seuils géométriques. Plutôt que d'exposer trois
 * crans figés, on garde trois jeux de seuils mesurés — exigeant, par défaut,
 * permissif — et on interpole entre eux : le curseur 0..1 de l'utilisateur
 * balaie alors tout l'intervalle, et les positions 0, 0,5 et 1 retombent
 * exactement sur les jeux validés.
 */

export const clampSensitivity = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

/**
 * Interpole chaque seuil entre trois jeux : 0 → `low`, 0,5 → `mid`, 1 → `high`.
 * Les trois objets doivent porter les mêmes clés, toutes numériques.
 */
export function mixTuning<T extends { [K in keyof T]: number }>(sensitivity: number, low: T, mid: T, high: T): T {
  const s = Math.min(1, Math.max(0, sensitivity));
  const a = s <= 0.5 ? low : mid;
  const b = s <= 0.5 ? mid : high;
  const t = s <= 0.5 ? s / 0.5 : (s - 0.5) / 0.5;
  const out = {} as T;
  for (const k of Object.keys(low) as Array<keyof T>) {
    out[k] = (a[k] + (b[k] - a[k]) * t) as T[keyof T];
  }
  return out;
}
