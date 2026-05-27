// Sprint 3 — shared NER calculator across observed units + Baxter units.

/**
 * Net effective rent.
 *
 * formula: ((gross * (leaseMonths - freeMonths)) - extraCredit) / leaseMonths
 *
 * @param grossRent       e.g. 2995
 * @param leaseMonths     e.g. 13 or 19
 * @param freeMonths      e.g. 1 (one month free) or 2
 * @param extraCredit     one-time look-and-lease credit applied over the term (default 0)
 */
export function calculateNetEffectiveRent(
  grossRent: number,
  leaseMonths: number,
  freeMonths: number,
  extraCredit = 0,
): number {
  if (!grossRent || !leaseMonths) return 0;
  const billable = leaseMonths - (freeMonths || 0);
  return Math.round(((grossRent * billable) - extraCredit) / leaseMonths * 100) / 100;
}

/**
 * Convenience: returns all four scenarios for a given gross rent, with the
 * standard Zen Hollywood concession set. UI shows each as "if applicable".
 */
export interface NerScenarios {
  ner_13m_1free: number;
  ner_13m_1free_lookAndLease: number;
  ner_19m_2free: number;
  ner_19m_2free_lookAndLease: number;
}

export function computeZenNerScenarios(grossRent: number, lookAndLeaseBonus = 1000): NerScenarios {
  return {
    ner_13m_1free: calculateNetEffectiveRent(grossRent, 13, 1, 0),
    ner_13m_1free_lookAndLease: calculateNetEffectiveRent(grossRent, 13, 1, lookAndLeaseBonus),
    ner_19m_2free: calculateNetEffectiveRent(grossRent, 19, 2, 0),
    ner_19m_2free_lookAndLease: calculateNetEffectiveRent(grossRent, 19, 2, lookAndLeaseBonus),
  };
}
