const DEPOSIT_PENCE = 2500;
const SLOT_MINUTES = 30;
const OPENING_MINUTES = 7 * 60;
const CLOSING_MINUTES = 22 * 60 + 30;
const ALLOWED_REGIONS = new Set(['greater-manchester','london-luton']);
const ALLOWED_FREQUENCIES = new Set(['once','weekly','fortnightly','monthly']);
const RATES = {
  regular: { hourly: 17, minimumHours: 2 },
  kitchen: { hourly: 20, minimumHours: 2 },
  deep: { hourly: 24, minimumHours: 3 },
  holiday: { hourly: 21, minimumHours: 2 },
  oneoff: { hourly: 20, minimumHours: 2 },
  tenancy: { hourly: 26, minimumHours: 4 },
  oven: { fixed: 20, minimumHours: 1 },
  carpet: { quoteOnly: true, minimumHours: 2 }
};

function clean(value, max, required = false) {
  const result = String(value ?? '').trim();
  if (required && !result) throw new Error('MISSING_REQUIRED_DETAILS');
  if (result.length > max) throw new Error('DETAIL_TOO_LONG');
  return result;
}
function allowed(value, values) {
  if (!values.has(value)) throw new Error('INVALID_BOOKING_OPTION');
  return value;
}
function roundHalf(value) { return Math.ceil(Number(value || 0) * 2) / 2; }
function timeToMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) throw new Error('INVALID_START_TIME');
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) % SLOT_MINUTES !== 0) throw new Error('INVALID_START_TIME');
  return minutes;
}
function minutesToTime(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
}
function slotIdFromMinutes(value) { return minutesToTime(value).replace(':','-'); }
function calculateTrustedEstimate(input) {
  const service = RATES[input.service];
  if (!service) throw new Error('INVALID_BOOKING_OPTION');
  const bedrooms = Math.max(1, Number(input.bedrooms || 1));
  const bathrooms = Math.max(1, Number(input.bathrooms || 1));
  let baseHours = 2 + Math.max(0, bedrooms - 1) * 0.6 + Math.max(0, bathrooms - 1) * 0.5;
  if (input.service === 'deep') baseHours *= 1.45;
  if (input.service === 'tenancy') baseHours *= 1.75;
  if (input.service === 'holiday') baseHours = Math.max(2, baseHours * 1.05);
  if (input.service === 'oven') baseHours = 1;
  const addonHours = (input.addons || []).reduce((total, addon) => total + ({inside_fridge:.5,inside_cabinets:.75,interior_windows:.75,ironing:1}[addon] || 0), 0);
  const hours = Math.max(service.minimumHours || 0, roundHalf(baseHours + addonHours));
  const total = service.quoteOnly ? null : service.fixed || Math.round(service.hourly * hours);
  return { hours, total };
}
function occupiedSlotIds(startTime, hours) {
  const start = timeToMinutes(startTime);
  const duration = Math.max(SLOT_MINUTES, Math.ceil(Number(hours || 0) * 60 / SLOT_MINUTES) * SLOT_MINUTES);
  const end = start + duration;
  if (start < OPENING_MINUTES || end > CLOSING_MINUTES) throw new Error('TIME_OUTSIDE_OPENING_HOURS');
  return Array.from({length: duration / SLOT_MINUTES}, (_, index) => slotIdFromMinutes(start + index * SLOT_MINUTES));
}
function validateBooking(input = {}) {
  const date = clean(input.date, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_DATE');
  const email = clean(input.email, 180, true).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('INVALID_EMAIL');
  const booking = {
    service: clean(input.service, 80, true),
    frequency: allowed(input.frequency || 'once', ALLOWED_FREQUENCIES),
    property_type: clean(input.property_type, 60, true),
    property_type_other: clean(input.property_type_other, 100),
    bedrooms: clean(input.bedrooms, 8, true),
    bathrooms: clean(input.bathrooms, 8, true),
    postcode: clean(input.postcode, 12, true).toUpperCase(),
    region: allowed(input.region, ALLOWED_REGIONS),
    date,
    time_slot: clean(input.time_slot, 80, true),
    addons: Array.isArray(input.addons) ? input.addons.slice(0, 12).map(v => clean(v, 60, true)) : [],
    addon_other: clean(input.addon_other || input.other_addon, 160),
    first_name: clean(input.first_name, 80, true),
    last_name: clean(input.last_name, 80, true),
    email,
    phone: clean(input.phone, 40, true),
    address: clean(input.address, 300, true),
    notes: clean(input.notes, 1200),
    terms: input.terms === true || input.terms === 'on',
    depositTerms: input.deposit_terms === true || input.deposit_terms === 'on',
    reference: clean(input.reference, 40, true),
    depositAmount: 25
  };
  booking.start = booking.time_slot.replace('-', ':');
  timeToMinutes(booking.start);
  const rawPreferred = Array.isArray(input.preferred_time_slots)
    ? input.preferred_time_slots
    : [];
  const preferred = [...new Set([booking.time_slot, ...rawPreferred]
    .map((value) => clean(value, 80))
    .filter(Boolean))]
    .slice(0, 12);
  preferred.forEach((slotId) => timeToMinutes(slotId.replace('-', ':')));
  booking.preferred_time_slots = preferred;
  booking.preferredStartTimes = preferred.map((slotId) => slotId.replace('-', ':'));
  const estimate = calculateTrustedEstimate(booking);
  booking.estimate = estimate.total;
  booking.estimatedHours = estimate.hours;
  booking.occupiedSlotIds = occupiedSlotIds(booking.start, estimate.hours);
  booking.end = minutesToTime(timeToMinutes(booking.start) + booking.occupiedSlotIds.length * SLOT_MINUTES);
  return booking;
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
module.exports = { DEPOSIT_PENCE, validateBooking, json };
