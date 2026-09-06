// `client-onboarding/03`, Approach step 3 — the metric/imperial display
// split, and the one place it happens.
//
// **The stored value is always centimetres**, matching
// `client_profiles.height_cm` and `CLAUDE.md` §0's weight rule applied to
// the same principle: conversion lives at the edges and nowhere else. A
// client on the ft/in setting is looking at a rendering of the same number,
// never at a second stored one.
//
// It is here rather than in `packages/utils` because it is a display
// concern of one screen and `packages/utils` is where a *product* rule
// would live. Promote it the moment a second surface needs feet and inches.

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

export type HeightUnit = 'cm' | 'ft';

export interface FeetInches {
  feet: number;
  inches: number;
}

/** Rounded to whole inches — the precision a person actually knows their height to. */
export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return {
    feet: Math.floor(totalInches / INCHES_PER_FOOT),
    inches: totalInches % INCHES_PER_FOOT,
  };
}

/** One decimal place, matching `height_cm numeric(5,1)` — more would be silently rounded by Postgres. */
export function feetInchesToCm(feet: number, inches: number): number {
  return Math.round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH * 10) / 10;
}

/**
 * A typed value in the active unit → centimetres, or null if it is not yet
 * a number. Never throws and never guesses: an empty or half-typed field is
 * "no height yet", which is a valid state mid-flow.
 */
export function parseHeightInput(
  unit: HeightUnit,
  raw: { cm: string } | { feet: string; inches: string },
): number | null {
  if (unit === 'cm') {
    const value = Number((raw as { cm: string }).cm.trim());
    return Number.isFinite(value) && value > 0 ? Math.round(value * 10) / 10 : null;
  }
  const { feet, inches } = raw as { feet: string; inches: string };
  const feetValue = Number(feet.trim());
  const inchesValue = inches.trim() === '' ? 0 : Number(inches.trim());
  if (!Number.isFinite(feetValue) || !Number.isFinite(inchesValue) || feetValue <= 0) {
    return null;
  }
  return feetInchesToCm(feetValue, inchesValue);
}
