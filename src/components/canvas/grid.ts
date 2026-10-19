import { formatNumber } from '../../lib/geometry';
import type { Size, View } from './types';

export type GridLine = { value: number; screen: number };

export type Grid = {
  step: number;
  majorVertical: GridLine[];
  majorHorizontal: GridLine[];
  minorVertical: GridLine[];
  minorHorizontal: GridLine[];
  axisX: number | null;
  axisY: number | null;
};

export function buildGrid(view: View, size: Size): Grid {
  if (size.width === 0 || size.height === 0) {
    return {
      step: 1,
      majorVertical: [],
      majorHorizontal: [],
      minorVertical: [],
      minorHorizontal: [],
      axisX: null,
      axisY: null,
    };
  }

  const targetPx = 90;
  const targetUnits = targetPx / view.scale;
  const exp = Math.floor(Math.log10(targetUnits));
  const base = Math.pow(10, exp);
  const remainder = targetUnits / base;
  let major: number;
  if (remainder < 1.5) major = base;
  else if (remainder < 3.5) major = 2 * base;
  else if (remainder < 7.5) major = 5 * base;
  else major = 10 * base;

  const minor = major / 5;

  const wxMin = view.centerX - size.width / 2 / view.scale;
  const wxMax = view.centerX + size.width / 2 / view.scale;
  const wyMin = view.centerY - size.height / 2 / view.scale;
  const wyMax = view.centerY + size.height / 2 / view.scale;

  const majorVertical = collectLines(wxMin, wxMax, major, (wx) => screenX(wx, view, size));
  const majorHorizontal = collectLines(wyMin, wyMax, major, (wy) => screenY(wy, view, size));
  const minorVertical = collectLines(wxMin, wxMax, minor, (wx) => screenX(wx, view, size)).filter(
    (line) => Math.abs(line.value / major - Math.round(line.value / major)) > 1e-6,
  );
  const minorHorizontal = collectLines(wyMin, wyMax, minor, (wy) => screenY(wy, view, size)).filter(
    (line) => Math.abs(line.value / major - Math.round(line.value / major)) > 1e-6,
  );

  const axisXScreen = screenY(0, view, size);
  const axisYScreen = screenX(0, view, size);

  return {
    step: major,
    majorVertical,
    majorHorizontal,
    minorVertical,
    minorHorizontal,
    axisX: axisXScreen >= 0 && axisXScreen <= size.height ? axisXScreen : null,
    axisY: axisYScreen >= 0 && axisYScreen <= size.width ? axisYScreen : null,
  };
}

export function collectLines(min: number, max: number, step: number, project: (value: number) => number): GridLine[] {
  const lines: GridLine[] = [];
  const start = Math.ceil(min / step) * step;
  const maxLines = 400;
  let count = 0;
  for (let value = start; value <= max && count < maxLines; value += step, count += 1) {
    const snapped = Math.round(value / step) * step;
    lines.push({ value: snapped, screen: project(snapped) });
  }
  return lines;
}

export function screenX(wx: number, view: View, size: Size): number {
  return size.width / 2 + (wx - view.centerX) * view.scale;
}

export function screenY(wy: number, view: View, size: Size): number {
  return size.height / 2 - (wy - view.centerY) * view.scale;
}

export function formatGridValue(value: number, step: number): string {
  if (step >= 1) return formatNumber(Math.round(value));
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
  const rounded = Number(value.toFixed(decimals));
  return formatNumber(rounded);
}

export function formatScale(scale: number): string {
  if (scale >= 1) return `${scale >= 100 ? scale.toFixed(0) : scale.toFixed(1)}×`;
  return `1/${(1 / scale).toFixed(scale > 0.01 ? 1 : 0)}×`;
}
