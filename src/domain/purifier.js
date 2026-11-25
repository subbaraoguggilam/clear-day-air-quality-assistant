// CADR (Clean Air Delivery Rate) and DIY Air Purifier Sizing Calculator
// Grounded in EPA & ASHRAE air change turnover models.

/**
 * Calculates air purifier requirements based on room dimensions and desired air changes per hour (ACH).
 * @param {{ areaSqFt?: number, areaSqM?: number, ceilingHeightFt?: number, targetAch?: number }} params
 * @returns {{
 *   roomVolumeCuFt: number,
 *   roomVolumeCuM: number,
 *   targetAch: number,
 *   requiredCfm: number,
 *   requiredM3h: number,
 *   clearanceTimeMinutes: number,
 *   recommendedSetup: { name: string, description: string, estimatedCost: string, filtersNeeded: number }
 * }}
 */
export function calculatePurifierNeeds({ areaSqFt, areaSqM, ceilingHeightFt = 9, targetAch = 4.5 } = {}) {
  const sqFt = areaSqFt != null
    ? Math.max(20, Math.min(2000, Number(areaSqFt)))
    : areaSqM != null
      ? Math.max(2, Math.min(200, Number(areaSqM))) * 10.7639
      : 150; // default bedroom 150 sq ft

  const height = Math.max(7, Math.min(16, Number(ceilingHeightFt) || 9));
  const ach = Math.max(2, Math.min(10, Number(targetAch) || 4.5));

  const volumeCuFt = Math.round(sqFt * height);
  const volumeCuM = Math.round(volumeCuFt * 0.0283168);

  const requiredCfm = Math.round((volumeCuFt * ach) / 60);
  const requiredM3h = Math.round(requiredCfm * 1.699);

  // Time to achieve ~80% particle removal: -ln(0.2) / ach * 60 minutes
  const clearanceTimeMinutes = Math.round((Math.log(5) / ach) * 60);

  let recommendedSetup;
  if (requiredCfm <= 140) {
    recommendedSetup = {
      name: 'Single-Filter Mini Fan Box',
      description: '1 × MERV-13 filter taped to the back of a standard 12"-16" table/box fan. Perfect for small bedrooms or study rooms.',
      estimatedCost: '₹1,000–₹1,500 ($12–$18)',
      filtersNeeded: 1,
    };
  } else if (requiredCfm <= 280) {
    recommendedSetup = {
      name: '2-Filter Wedge Corsi-Rosenthal Box',
      description: '2 × MERV-13 filters arranged in a V-wedge with cardboard top/bottom and a 20" box fan. Low noise and compact footprint.',
      estimatedCost: '₹1,800–₹2,500 ($22–$30)',
      filtersNeeded: 2,
    };
  } else {
    recommendedSetup = {
      name: 'Full 4-Filter Corsi-Rosenthal Cube',
      description: '4 × MERV-13 furnace filters formed into a 3D cube with shroud-equipped box fan on top. Cleans large spaces and living rooms rapidly.',
      estimatedCost: '₹2,800–₹3,800 ($34–$45)',
      filtersNeeded: 4,
    };
  }

  return {
    roomVolumeCuFt: volumeCuFt,
    roomVolumeCuM: volumeCuM,
    targetAch: ach,
    requiredCfm,
    requiredM3h,
    clearanceTimeMinutes,
    recommendedSetup,
  };
}
