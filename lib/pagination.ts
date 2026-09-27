// lib/pagination.ts
//
// SERVER-ONLY (works with the Supabase client, so it needs the same
// runtime as lib/supabase.ts). Supabase caps any single request at 1000
// rows by default — a query that just does `.select("*")` on a growing
// table will silently return only the first 1000 rows forever, with no
// error to say so. This was flagged as a real bug in the original app
// (see the project README's review of the old code) and is the reason
// nothing in this project reads a potentially-large table without
// going through this helper.
//
// Usage:
//   const allPayments = await fetchAllRows((range) =>
//     db.from("payments").select("*").range(range.from, range.to)
//   );

import type { PostgrestResponse } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;

export interface Range {
  from: number;
  to: number;
}

/**
 * Calls `queryPage` repeatedly, each time asking for the next 1000-row
 * page, until a page comes back with fewer rows than requested (the
 * signal that it was the last one). Throws if any page's query errors,
 * rather than silently returning a partial result — a caller doing sums
 * or balances must be able to trust it either got everything or got
 * nothing.
 */
export async function fetchAllRows<T>(
  queryPage: (range: Range) => PromiseLike<PostgrestResponse<T>>
): Promise<T[]> {
  const results: T[] = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await queryPage({ from, to });

    if (error) {
      throw new Error(`fetchAllRows: query failed at rows ${from}-${to}: ${error.message}`);
    }

    const page = data ?? [];
    results.push(...page);

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return results;
}
