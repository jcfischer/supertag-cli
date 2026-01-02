/**
 * Date Resolver
 * Spec 063: Unified Query Language
 *
 * Resolves relative date strings (today, 7d, 1w) to Unix timestamps.
 */

/**
 * Check if a string is a relative date value
 */
export function isRelativeDateValue(value: string): boolean {
  if (value === "today" || value === "yesterday") {
    return true;
  }
  // Match Nd, Nw, Nm, Ny where N is a positive integer
  return /^\d+[dwmy]$/.test(value);
}

/**
 * Get the start of a day (midnight UTC)
 */
function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

/**
 * Resolve a relative date string to a Unix timestamp (ms)
 *
 * Supported formats:
 * - "today" - Start of today
 * - "yesterday" - Start of yesterday
 * - "Nd" - N days ago (e.g., "7d")
 * - "Nw" - N weeks ago (e.g., "2w")
 * - "Nm" - N months ago (e.g., "1m")
 * - "Ny" - N years ago (e.g., "1y")
 *
 * @param value - Relative date string
 * @returns Unix timestamp in milliseconds
 * @throws Error if value is not a valid relative date
 */
export function resolveRelativeDate(value: string): number {
  const now = new Date(Date.now());

  if (value === "today") {
    return startOfDay(now).getTime();
  }

  if (value === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return startOfDay(yesterday).getTime();
  }

  // Parse duration notation: Nd, Nw, Nm, Ny
  const match = value.match(/^(\d+)([dwmy])$/);
  if (!match) {
    throw new Error(`Invalid relative date format: "${value}". Expected: today, yesterday, Nd, Nw, Nm, or Ny`);
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2];

  const result = new Date(now);

  switch (unit) {
    case "d":
      result.setDate(result.getDate() - amount);
      break;
    case "w":
      result.setDate(result.getDate() - amount * 7);
      break;
    case "m":
      result.setMonth(result.getMonth() - amount);
      break;
    case "y":
      result.setFullYear(result.getFullYear() - amount);
      break;
  }

  return startOfDay(result).getTime();
}

/**
 * Parse a date value that can be:
 * - A relative date string (today, 7d, 1w)
 * - An ISO 8601 date string (2025-01-15)
 * - An ISO 8601 datetime string (2025-01-15T14:30:00Z)
 * - A Unix timestamp in milliseconds
 *
 * @param value - Date value to parse
 * @returns Unix timestamp in milliseconds
 * @throws Error if value cannot be parsed as a date
 */
export function parseDateValue(value: string | number): number {
  // If it's already a number, return as-is
  if (typeof value === "number") {
    return value;
  }

  // Check if it's a relative date
  if (isRelativeDateValue(value)) {
    return resolveRelativeDate(value);
  }

  // Try to parse as ISO date
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: "${value}". Expected ISO 8601 (YYYY-MM-DD) or relative (7d, 1w, today)`);
  }

  return date.getTime();
}
