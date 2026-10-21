/**
 * Page size from the measured height (UD-017). Nothing here is a number somebody chose: a page holds
 * as many rows as add up to the height the frame has, and each row is measured, not assumed, because
 * a card with a long title is taller than one without.
 */

/** How many of the rows, in order, fit in `available` px. At least one: a row taller than the frame still gets a page. */
export function fitCount(heights: readonly number[], available: number): number {
  let used = 0
  let n = 0
  for (const h of heights) {
    if (used + h > available + 0.5) break
    used += h
    n += 1
  }
  return Math.max(1, n)
}

/** Sum of the heights. */
export const total = (heights: readonly number[]) => heights.reduce((a, b) => a + b, 0)

export interface Range {
  from: number
  to: number
  total: number
}

/** 1-based range shown on a page that starts at `start` and holds `count` rows. */
export function pageRange(start: number, count: number, totalRows: number): Range {
  return { from: totalRows === 0 ? 0 : start + 1, to: Math.min(totalRows, start + count), total: totalRows }
}
