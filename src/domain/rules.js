// Deterministic safety layer. The LLM writes inside these limits and may not break them.
import { classifyAqi } from './aqi.js';

export const DISCLAIMER = 'This is general guidance, not medical advice. Follow your doctor for any health condition.';
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

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

// Words the advice must not contain when outdoor exertion is unsafe. Conservative on purpose.
export function forbiddenPattern(aqi) {
  return aqi > 150 ? /\b(jog(ging)?|run(ning)?|cycl(e|ing)|bik(e|ing)|sprint(ing)?)\b/i : null;
}

// Used when the LLM is down or its output fails validation.
export function fallbackAdvice({ aqi, constraints, bestWindow, impact }) {
  const ids = new Set(constraints.map((c) => c.id));
  const w = bestWindow ? `${hh(bestWindow.startHour)} to ${hh(bestWindow.endHour)}` : 'the middle of the day';
  const swap = impact.co2
    ? { swap: 'Take the metro for your commute on high smog days.', benefit: `Saves about ${impact.co2.savedKgDay} kg CO₂ a day compared with your current commute.` }
    : { swap: 'Combine errands into a single trip.', benefit: 'Fewer trips means fewer hours in traffic fumes and lower emissions.' };
  return {
    summary: `The air quality index is ${aqi} (${classifyAqi(aqi).label}). This plan comes from built in safety rules because the AI service was not available.`,
    routine: [
      { time: 'Morning', action: ids.has('stay_in') ? 'Stay indoors with windows closed.' : 'Keep outdoor time short and windows closed.', why: 'Smog is usually densest in the early morning.' },
      { time: w, action: 'Do essential errands or ventilate your home for ten minutes.', why: 'This is the cleanest forecast window today.' },
      { time: 'Commute', action: ids.has('mask') ? 'Wear a fitted N95 or FFP2 mask and avoid busy roads.' : 'Choose quieter roads where you can.', why: 'Traffic corridors carry the highest particle levels.' },
      { time: 'Evening', action: 'Keep windows closed and use a fan or air purifier if you have one.', why: 'Smog settles again after sunset.' },
    ],
    indoor_hacks: [
      { tip: 'Wet mop floors and wipe surfaces instead of dry sweeping.', impact: 'Stops settled dust from going back into the air.' },
      { tip: 'Use the kitchen exhaust fan while cooking and for ten minutes after.', impact: 'Removes cooking particles before they spread through the home.' },
      { tip: 'Avoid incense, mosquito coils and burning waste indoors.', impact: 'Removes a major source of indoor PM2.5.' },
    ],
    alternatives: [swap],
  };
}
