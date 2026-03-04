export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function bonusMultiplier(bonusPct) {
  return 1 + (Math.max(0, bonusPct) / 100);
}

export function fidelityMultiplier(fidelityPct) {
  return 1 + (clamp(fidelityPct, 0, 10) / 100);
}

export function fmt(value, digits = 2) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    })
    : "0.00";
}

export function fmtSignedDelta(value, digits = 2) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return fmt(0, digits);
  }
  const sign = value > 0 ? "+" : "-";
  return `${sign}${fmt(Math.abs(value), digits)}`;
}

export function deltaClassForValue(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return "delta-neutral";
  }
  return value > 0 ? "delta-positive" : "delta-negative";
}

export function deltaSuffix(currentValue, referenceValue, digits = 2) {
  if (!Number.isFinite(referenceValue)) {
    return "";
  }

  const delta = currentValue - referenceValue;
  const formattedDelta = fmtSignedDelta(delta, digits);
  const zeroDisplay = fmt(0, digits);

  if (
    formattedDelta === zeroDisplay
    || formattedDelta === `+${zeroDisplay}`
    || formattedDelta === `-${zeroDisplay}`
  ) {
    return "";
  }

  return ` <span class="delta-note ${deltaClassForValue(delta)}">${formattedDelta} vs other scenario</span>`;
}
