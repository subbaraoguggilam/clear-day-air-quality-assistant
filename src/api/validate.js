// Whitelist validation for every request field. Nothing unchecked reaches a prompt.
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new AppError(400, m);
const COMMUTE = ['two_wheeler', 'car', 'bus', 'metro', 'walk_cycle', 'wfh'];
const COOKING = ['lpg', 'wood', 'induction'];
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`Choose a valid ${name}.`); return v; };
const num = (v, min, max, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw bad(`${name} must be a number from ${min} to ${max}.`);
  return v;
};

export function parseRequest(body, { needQuestion = false } = {}) {
  if (!body || typeof body !== 'object') throw bad('Request body is required.');
  let location;
  if (body.lat !== undefined) {
    location = { lat: num(body.lat, -90, 90, 'Latitude'), lon: num(body.lon, -180, 180, 'Longitude') };
  } else {
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    if (city.length < 2 || city.length > 60) throw bad('Enter a city name of 2 to 60 characters.');
    location = { city };
  }
  const p = body.profile ?? {};
  const profile = {
    children: p.children === true, elderly: p.elderly === true, asthma: p.asthma === true, pregnancy: p.pregnancy === true,
    commute: oneOf(p.commute, COMMUTE, 'commute'),
    cooking: oneOf(p.cooking, COOKING, 'cooking fuel'),
    distanceKm: num(p.distanceKm, 0, 100, 'Commute distance'),
  };
  let question;
  if (needQuestion) {
    question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 300) throw bad('Ask a question of up to 300 characters.');
  }
  return { location, profile, question };
}
