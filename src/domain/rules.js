// Deterministic safety layer. The LLM writes inside these limits and may not break them.
import { classifyAqi } from './aqi.js';
import { calculatePurifierNeeds } from './purifier.js';

export const DISCLAIMER = 'This is general guidance, not medical advice. Follow your doctor for any health condition.';
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

/**
 * Builds deterministic safety constraints based on AQI thresholds and household vulnerabilities.
 * @param {number} aqi - Air Quality Index
 * @param {{ children?: boolean, elderly?: boolean, asthma?: boolean, pregnancy?: boolean, cooking?: string }} p - Profile
 * @returns {Array<{ id: string, text: string }>}
 */
export function buildConstraints(aqi, p) {
  const sensitive = p.children || p.elderly || p.asthma || p.pregnancy;
  const c = [];
  const add = (id, text) => c.push({ id, text });
  if (aqi > 300) add('stay_in', 'Stay indoors. Avoid all outdoor activity.');
  if (aqi > 150) add('no_outdoor_exercise', 'No outdoor exercise or sport for anyone.');
  else if (aqi > 100 && sensitive) add('limit_sensitive', 'Keep outdoor play and exertion short for sensitive family members.');
  if (aqi > 100 && (sensitive || aqi > 150)) add('mask', 'Wear a fitted N95 or FFP2 mask outdoors.');
  if (aqi > 100) add('windows', 'Keep windows closed except one short ventilation slot when outdoor air is cleanest.');
  if (aqi > 100 && p.cooking === 'wood') add('wood_cooking', 'Ventilate the kitchen while cooking and avoid cooking during peak smog hours.');
  if (aqi > 100 && p.asthma) add('asthma', 'Keep reliever medication within reach and follow your doctor’s asthma plan.');
  return c;
}

/**
 * Generates regex pattern for forbidden exertion words when outdoor air is unsafe.
 * @param {number} aqi - Air Quality Index
 * @returns {RegExp | null}
 */
export function forbiddenPattern(aqi) {
  return aqi > 150 ? /\b(jog(ging)?|run(ning)?|cycl(e|ing)|bik(e|ing)|sprint(ing)?)\b/i : null;
}

/**
 * Returns an urgent alert banner when AQI crosses safety thresholds.
 * @param {number} aqi - Air Quality Index
 * @param {boolean} sensitive - Whether household has vulnerable members
 * @returns {{ level: string, text: string, color: string } | null}
 */
export function getAlertBanner(aqi, sensitive) {
  if (aqi > 300) return { level: 'emergency', text: 'Hazardous air — stay indoors immediately. Seal doors and windows.', color: '#7F1D1D' };
  if (aqi > 200) return { level: 'danger',    text: 'Very unhealthy air — avoid all outdoor activity.',              color: '#A855F7' };
  if (aqi > 150) return { level: 'warning',   text: 'Unhealthy air — no outdoor exercise for anyone.',              color: '#EF4444' };
  if (aqi > 100 && sensitive) return { level: 'caution', text: 'Sensitive household alert — limit outdoor time.',    color: '#F97316' };
  return null;
}

/**
 * Returns complete DIY Corsi-Rosenthal filter build instructions and material specifications.
 * @returns {{ title: string, cost: string, effectiveness: string, materials: string[], steps: string[], tips: string[] }}
 */
export function getDiyFilterGuide() {
  const standardRoom = calculatePurifierNeeds({ areaSqFt: 150 });
  return {
    title: 'DIY Corsi-Rosenthal Box Air Filter',
    cost: 'Approx ₹1,000–₹2,500',
    effectiveness: 'Reduces indoor PM2.5 by up to 70% — comparable to commercial HEPA purifiers costing 10x more.',
    baseline: standardRoom,
    materials: [
      '4 × MERV-13 furnace filters (20×20 cm or standard box-fan size)',
      '1 × box fan (same size as filters)',
      'Cardboard or duct tape to seal gaps',
    ],
    steps: [
      'Arrange the 4 filters in a square cube, with arrows pointing INWARD on all sides.',
      'Tape all edges where filters meet to prevent air bypass.',
      'Place the fan on top pointing UP (blowing air out of the cube).',
      'Seal any gaps between fan and filters with cardboard and tape.',
      'Plug in and run on medium speed — place in the most-used room.',
      'Replace filters when visibly grey or every 3–6 months.',
    ],
    tips: [
      'Run continuously during high AQI days — the filter itself becomes part of the air path.',
      'A 20×20 cm fan covers a 20–30 m² room effectively.',
      'Available at hardware stores: Havells, Orient, or similar box fans work well.',
      `For a typical bedroom (150 sq ft), requires ~${standardRoom.requiredCfm} CFM to clear ~80% of particles in ${standardRoom.clearanceTimeMinutes} minutes.`,
    ],
  };
}

/**
 * Builds profile-specific indoor air hacks with clear cause-and-effect explanations.
 * @param {{ cooking?: string, asthma?: boolean }} [profile]
 * @param {number} [aqi=150]
 * @returns {Array<{ tip: string, impact: string }>}
 */
export function buildTailoredIndoorHacks(profile = {}, aqi = 150) {
  const cookingHack =
    profile.cooking === 'wood'
      ? {
          tip: 'Ventilate the kitchen directly outdoors while cooking and move prep to cleaner midday hours.',
          impact: 'Biomass smoke releases dense fine particles indoors; direct venting cuts indoor smoke buildup sharply.',
        }
      : profile.cooking === 'lpg'
        ? {
            tip: 'Switch on the kitchen exhaust fan or crack a kitchen window during gas cooking and for ten minutes after.',
            impact: 'Removes combustion gases like nitrogen dioxide and cooking fine dust before they drift into bedrooms.',
          }
        : {
            tip: 'Use lids on pots and switch on your kitchen exhaust fan when frying or searing on induction.',
            impact: 'Captures cooking oil aerosol particles at the source while keeping zero indoor fuel combustion.',
          };

  const sealingHack =
    aqi > 100
      ? {
          tip: 'Create one clean sanctuary room by keeping bedroom doors shut and sealing bottom door gaps with a rolled damp towel.',
          impact: 'Slows outdoor smog infiltration so sleeping hours stay significantly cleaner.',
        }
      : {
          tip: 'Cross-ventilate by opening opposite windows for 15 minutes during the cleanest window.',
          impact: 'Flushes stale indoor carbon dioxide and household volatile fumes without needing extra electricity.',
        };

  return [
    {
      tip: 'Wet mop floors and wipe surfaces with a damp cloth instead of dry sweeping or dusting.',
      impact: 'Traps settled fine dust in water rather than kicking PM2.5 particles back up to breathing height.',
    },
    cookingHack,
    sealingHack,
  ];
}

/**
 * Builds two low-emission, practical daily swaps grounded in the user's profile and computed CO2 savings.
 * @param {{ commute?: string, cooking?: string }} [profile]
 * @param {any} [impact]
 * @returns {Array<{ swap: string, benefit: string }>}
 */
export function buildTailoredSwaps(profile = {}, impact = {}) {
  const commuteSwap = impact?.co2
    ? {
        swap: 'Shift daily trips from your current vehicle to metro rail or electric public transit.',
        benefit: `Cuts tailpipe emissions by ${impact.co2.savedKgDay} kg CO₂ per day (${impact.co2.savedKgWeek} kg per week) and lowers street-level fume exposure.`,
      }
    : profile.commute === 'wfh'
      ? {
          swap: 'Batch grocery and pharmacy errands into one off-peak trip rather than separate outings.',
          benefit: 'Eliminates extra cold-start vehicle trips and keeps your outdoor exposure brief during peak smog.',
        }
      : {
          swap: 'Keep using zero-tailpipe or shared metro transit and avoid peak rush-hour intersections.',
          benefit: 'Maintains the lowest commute carbon footprint while steering clear of idling exhaust plumes.',
        };

  const homeSwap =
    profile.cooking === 'wood'
      ? {
          swap: 'Use an electric kettle, rice cooker, or induction hotplate for tea and quick meals instead of wood.',
          benefit: 'Eliminates indoor biomass smoke during high-smog days and protects sensitive lungs indoors.',
        }
      : {
          swap: 'Replace incense sticks, mosquito coils, and scented candles with electric liquid vaporisers or natural ventilation.',
          benefit: 'Removes a hidden indoor PM2.5 source that can rival busy roadside air inside a closed room.',
        };

  return [commuteSwap, homeSwap];
}

/**
 * Generates deterministic rule-based advice fallback when AI services are unavailable.
 * Supports both direct { aqi, ... } objects and full server context { air: { aqi }, ... }.
 * @param {{ aqi?: number, air?: { aqi: number }, constraints?: Array<{ id: string, text: string }>, bestWindow?: { startHour: number, endHour: number } | null, impact?: any, profile?: any }} params
 * @returns {{ summary: string, routine: Array<{ time: string, action: string, why: string }>, indoor_hacks: Array<{ tip: string, impact: string }>, alternatives: Array<{ swap: string, benefit: string }> }}
 */
export function fallbackAdvice({ aqi, air, constraints = [], bestWindow = null, impact = {}, profile = {} }) {
  const resolvedAqi = aqi ?? air?.aqi ?? 0;
  const band = classifyAqi(resolvedAqi);
  const ids = new Set(constraints.map((c) => c.id));
  const w = bestWindow ? `${hh(bestWindow.startHour)} to ${hh(bestWindow.endHour)}` : '12:00 to 14:00';
  const isGoodOrModerate = resolvedAqi <= 100;

  const morningAction = ids.has('stay_in')
    ? 'Stay indoors with doors and windows sealed and operate an air purifier if available.'
    : resolvedAqi > 100
      ? 'Keep morning outdoor time brief and keep street-facing windows shut.'
      : resolvedAqi <= 50
        ? 'Enjoy normal morning outdoor routines and open windows for fresh airflow.'
        : 'Do light morning routines outdoors, pacing prolonged exertion for sensitive members.';

  const windowAction =
    resolvedAqi > 300
      ? 'Keep outdoor trips cancelled; briefly crack a window for five minutes only if indoor air feels stuffy.'
      : resolvedAqi > 200
        ? 'Limit outings to essential errands only during this window with a fitted N95 mask.'
        : resolvedAqi > 100
          ? 'Schedule essential errands and a ten-minute cross-ventilation window now.'
          : 'Ideal window for outdoor movement, errands, and refreshing indoor air.';

  const commuteAction =
    profile.commute === 'wfh'
      ? ids.has('mask')
        ? 'Work from home away from street-facing windows and wear a fitted N95 mask for any quick doorstep errand.'
        : 'Keep your workspace well ventilated during the cleanest midday window.'
      : ids.has('mask')
        ? 'Wear a fitted N95 or FFP2 mask and pick quieter side streets away from heavy diesel traffic.'
        : 'Take shaded, lower-traffic routes and keep vehicle cabin recirculation on in congestion.';

  const eveningAction = isGoodOrModerate
    ? 'Unwind outdoors or ventilate lightly before nightfall, avoiding smoky bonfires or burning waste.'
    : 'Close exterior windows before dusk and operate a fan filter or purifier in your main living space.';

  return {
    summary: `The air quality index is ${resolvedAqi} (${band.label}). This plan comes from built in safety rules because the AI service was not available.`,
    routine: [
      {
        time: 'Morning',
        action: morningAction,
        why: isGoodOrModerate
          ? 'Current morning air quality falls within safer dispersion levels.'
          : 'Cool morning air traps overnight traffic and heating emissions close to ground level.',
      },
      {
        time: w,
        action: windowAction,
        why: bestWindow
          ? `Forecast identifies this as the cleanest two-hour window today (${bestWindow.pm25} µg/m³ PM2.5).`
          : 'Midday sunlight typically lifts trapped smog higher into the atmosphere.',
      },
      {
        time: 'Commute',
        action: commuteAction,
        why: 'Main traffic corridors carry concentrated exhaust and road dust near breathing height.',
      },
      {
        time: 'Evening',
        action: eveningAction,
        why: isGoodOrModerate
          ? 'Evening local burning can still create localized smoke pockets even on cleaner days.'
          : 'Cooling evening temperatures form a thermal inversion layer that traps smog after sunset.',
      },
    ],
    indoor_hacks: buildTailoredIndoorHacks(profile, resolvedAqi),
    alternatives: buildTailoredSwaps(profile, impact),
  };
}
