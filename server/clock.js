/**
 * Test/demo hook: freeze the model clock.
 *
 * Set DARJAM_NOW to an ISO timestamp or epoch milliseconds to make every
 * endpoint compute as if that time were "now". Never set this in production.
 */
const override = process.env.DARJAM_NOW;

function parseOverride(value) {
  if (!value) return null;
  const epoch = /^\d+$/.test(value) ? Number(value) : NaN;
  const parsed = Number.isFinite(epoch) ? epoch : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const fixed = parseOverride(override);

export function nowMs() {
  return fixed ?? Date.now();
}
