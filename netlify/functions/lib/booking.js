const DEPOSIT_PENCE = 2500;
const ALLOWED_REGIONS = new Set(['greater-manchester','london-luton']);
const ALLOWED_FREQUENCIES = new Set(['once','weekly','fortnightly','monthly']);

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
function validateBooking(input = {}) {
  const date = clean(input.date, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_DATE');
  const email = clean(input.email, 180, true).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('INVALID_EMAIL');
  return {
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
    estimate: Number.isFinite(Number(input.estimate)) ? Number(input.estimate) : null,
    estimatedHours: Number.isFinite(Number(input.estimatedHours)) ? Number(input.estimatedHours) : null,
    reference: clean(input.reference, 40, true),
    depositAmount: 25
  };
}
function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}
module.exports = { DEPOSIT_PENCE, validateBooking, json };
