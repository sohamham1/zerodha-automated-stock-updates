import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function weekKey(date = new Date()) {
  const next = new Date(date);
  const day = next.getUTCDay() || 7;
  next.setUTCDate(next.getUTCDate() - day + 1);
  return next.toISOString().slice(0, 10);
}

export function isoDateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function parseKiteDate(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).replace(" ", "T");
  const withZone = /z$/i.test(normalized) ? normalized : `${normalized}+05:30`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function isSameOrAfter(date, boundary) {
  return date && boundary ? date.valueOf() >= boundary.valueOf() : false;
}

export function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function dedupeBy(items, selector) {
  const seen = new Set();
  const next = [];
  for (const item of items) {
    const key = selector(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return undefined;
}

export function sentimentLabel(score) {
  if (score >= 1) {
    return "bullish";
  }
  if (score <= -1) {
    return "cautious";
  }
  return "neutral";
}
