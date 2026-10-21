// lib/pdf-table.ts
//
// Pure (no PDF library, no Node, no database) table reader for the real
// M-PESA statement layout. It takes the loose pieces of text a PDF
// library reports — each with a position — and rebuilds the table rows.
//
// WHY THIS EXISTS. The first version of the PDF reader glued together
// everything at the same height into one "line" and then looked for a
// date and time next to each other. A real statement, looked at for the
// first time on 21 Oct 2026, is laid out like a spreadsheet where every
// cell wraps onto several lines:
//
//     UIT3W8YRNG   2026-09-29    Merchant Payment Online   Completed  900.00 ...
//                  18:36:54      from - 254727***362
//                                SOME NAME
//
// The date and the time sit on DIFFERENT lines, and the details text
// wraps over three. A line-by-line reader cannot put that back together.
// This one works the way a person reads it:
//
//   1. find the header row ("Receipt No.", "Completion Time", ...) and
//      note where each column sits across the page;
//   2. find each row's starting point: the receipt code in the first
//      column (like UIT3W8YRNG);
//   3. give every other piece of text to the row above it, and to the
//      column it sits closest to;
//   4. join each cell's pieces back together.
//
// It does not care whether the PDF library counts height from the top or
// the bottom of the page: it works that out from the data (a time of day
// always sits below its date).
//
// What it can NOT do: read a PDF whose table is a picture. A screenshot
// or "print to PDF" copy has no text in it at all; see
// lib/pdf-statement.ts, which reports that clearly instead of failing
// silently.

import type { RawStatementRow } from "./statement-parser.ts";

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  /** Width of the text in page units; estimated from the length if the PDF library does not give it. */
  width?: number;
}

type ColumnKey = "receipt" | "completion" | "details" | "status" | "paidIn" | "withdrawn" | "balance" | "type" | "other";

const COLUMN_ORDER: ColumnKey[] = [
  "receipt",
  "completion",
  "details",
  "status",
  "paidIn",
  "withdrawn",
  "balance",
  "type",
  "other",
];

const LINE_TOLERANCE = 3.5; // items this close in height count as "the same line"
const MAX_ROW_HEIGHT = 60; // a row never has text further than this below its receipt code
const RECEIPT_RE = /^(?=.*\d)[A-Za-z0-9]{8,12}$/; // letters+digits, e.g. UIT3W8YRNG
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function widthOf(item: PdfTextItem): number {
  return item.width !== undefined && item.width > 0 ? item.width : item.str.length * 4.5;
}
function centreOf(item: PdfTextItem): number {
  return item.x + widthOf(item) / 2;
}

/**
 * PDF libraries differ in how much text they hand over as one piece: some
 * give single words, others whole phrases ("Receipt No.", "Completion Time",
 * even "2026-09-29 18:36:54"). Splitting every piece into words, with the
 * position of each word estimated from its place in the text, makes the
 * header and date detection below work either way.
 */
export function splitIntoWords(items: PdfTextItem[]): PdfTextItem[] {
  const words: PdfTextItem[] = [];
  for (const item of items) {
    const str = item.str;
    if (!str || str.trim() === "") continue;
    if (!/\s/.test(str.trim())) {
      words.push({ ...item, str: str.trim() });
      continue;
    }
    const width = widthOf(item);
    const total = str.length || 1;
    const re = /\S+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(str)) !== null) {
      words.push({
        str: match[0],
        x: item.x + (width * match.index) / total,
        y: item.y,
        width: (width * match[0].length) / total,
      });
    }
  }
  return words;
}

interface Header {
  y: number;
  /** Centre of each column, left to right. */
  centres: Record<ColumnKey, number>;
}

/**
 * Looks for the header row in these (already direction-normalised) items.
 * The first header line holds, left to right: Receipt No. | Completion |
 * Details | Transaction | Paid In | Withdrawn | Balance | Transaction |
 * Other Party. (Some labels wrap onto a second line; only the first line
 * is needed to find the column centres.)
 */
function findHeaders(items: PdfTextItem[]): Header[] {
  const headers: Header[] = [];
  const receiptWords = items.filter((i) => i.str.trim().toLowerCase() === "receipt");

  for (const start of receiptWords) {
    const line = items
      .filter((i) => Math.abs(i.y - start.y) <= LINE_TOLERANCE)
      .sort((a, b) => a.x - b.x);

    // Walk the line, grouping words into labels in the known column order.
    const labels: PdfTextItem[][] = [];
    const firstWords = ["Receipt", "Completion", "Details", "Transaction", "Paid", "Withdrawn", "Balance", "Transaction", "Other"];
    let next = 0;
    for (const word of line) {
      const text = word.str.trim().toLowerCase();
      if (next < firstWords.length && text === firstWords[next].toLowerCase()) {
        labels.push([word]);
        next++;
      } else if (labels.length > 0 && ["no.", "no", "time", "status", "in", "type", "party"].includes(text)) {
        labels[labels.length - 1].push(word);
      }
    }
    if (labels.length !== COLUMN_ORDER.length) continue;

    const centres = {} as Record<ColumnKey, number>;
    labels.forEach((label, idx) => {
      const left = Math.min(...label.map((w) => w.x));
      const right = Math.max(...label.map((w) => w.x + widthOf(w)));
      centres[COLUMN_ORDER[idx]] = (left + right) / 2;
    });
    headers.push({ y: start.y, centres });
  }
  return headers;
}

function nearestColumn(item: PdfTextItem, centres: Record<ColumnKey, number>): ColumnKey {
  const c = centreOf(item);
  let best: ColumnKey = "details";
  let bestDistance = Infinity;
  for (const key of COLUMN_ORDER) {
    const distance = Math.abs(centres[key] - c);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = key;
    }
  }
  return best;
}

/**
 * Does height grow downward (+1) or upward (-1) in these items? A time of
 * day ("18:36:54") always sits on the line below its date ("2026-09-29").
 * Returns null when the page has no date/time pair to learn from.
 */
export function detectDirection(items: PdfTextItem[]): 1 | -1 | null {
  let down = 0;
  let up = 0;
  const words = splitIntoWords(items);
  const dates = words.filter((i) => DATE_RE.test(i.str));
  const times = words.filter((i) => TIME_RE.test(i.str));
  for (const d of dates) {
    const t = times.find((c) => Math.abs(c.x - d.x) < 12 && Math.abs(c.y - d.y) > 3 && Math.abs(c.y - d.y) < 25);
    if (!t) continue;
    if (t.y > d.y) down++;
    else up++;
  }
  if (down === 0 && up === 0) return null;
  return down >= up ? 1 : -1;
}

export interface PageTableResult {
  rows: RawStatementRow[];
  /** The column layout found on this page, so a following page with no header can reuse it. */
  headerFound: boolean;
}

/**
 * Rebuilds the statement rows from one page's text items.
 *
 * `fallbackCentres` and `fallbackDirection` are what the previous page
 * found, used when this page continues the table without repeating the
 * header (or has too few rows to tell which way is down).
 */
export function readTablePage(
  rawItems: PdfTextItem[],
  fallback?: { centres?: Record<ColumnKey, number>; direction?: 1 | -1 }
): PageTableResult & { centres?: Record<ColumnKey, number>; direction: 1 | -1 } {
  const direction = detectDirection(rawItems) ?? fallback?.direction ?? 1;
  // Normalise so that a bigger y always means "further down the page".
  const items = rawItems
    .filter((i) => i.str && i.str.trim() !== "")
    .map((i) => ({ ...i, y: i.y * direction }));

  const words = splitIntoWords(items);
  const headers = findHeaders(words).sort((a, b) => a.y - b.y);
  const centres = headers[0]?.centres ?? fallback?.centres;

  if (!centres) {
    return { rows: [], headerFound: false, direction };
  }

  // Row starting points: a receipt-looking word in the first column.
  // A real transaction also has its date printed on the same line, in the
  // Completion Time column. That rules out look-alikes such as the
  // "Statement Verification Code" in the page footer (P9XWWGK2), which has
  // the same shape as a receipt code but no date beside it.
  const hasDateOnSameLine = (anchor: PdfTextItem) =>
    words.some(
      (i) =>
        DATE_RE.test(i.str) &&
        Math.abs(i.y - anchor.y) <= LINE_TOLERANCE &&
        nearestColumn(i, centres) === "completion"
    );
  const anchors = items
    .filter((i) => RECEIPT_RE.test(i.str.trim()) && nearestColumn(i, centres) === "receipt" && hasDateOnSameLine(i))
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // Things that end a row early: a new header line, a section title such as
  // "Account Type - Utility Account", or the page footer.
  const barriers: number[] = headers.map((h) => h.y);
  for (const word of words) {
    const text = word.str.trim();
    if (text === "Account" || text === "Disclaimer:" || text === "Disclaimer") barriers.push(word.y);
  }
  barriers.sort((a, b) => a - b);

  const cellParts = new Map<number, Map<ColumnKey, PdfTextItem[]>>();
  anchors.forEach((_, idx) => cellParts.set(idx, new Map()));

  for (const item of items) {
    // The row this item belongs to: the last anchor at or above it.
    let rowIndex = -1;
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].y <= item.y + LINE_TOLERANCE) rowIndex = i;
      else break;
    }
    if (rowIndex === -1) continue;
    const anchor = anchors[rowIndex];
    if (item.y - anchor.y > MAX_ROW_HEIGHT) continue;
    const barrier = barriers.find((b) => b > anchor.y + LINE_TOLERANCE);
    if (barrier !== undefined && item.y >= barrier - LINE_TOLERANCE) continue;

    const column = nearestColumn(item, centres);
    const row = cellParts.get(rowIndex)!;
    const list = row.get(column) ?? [];
    list.push(item);
    row.set(column, list);
  }

  const rows: RawStatementRow[] = [];
  anchors.forEach((anchor, idx) => {
    const cells = cellParts.get(idx)!;
    const text = (key: ColumnKey, glue: string) =>
      (cells.get(key) ?? [])
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((i) => i.str.trim())
        .join(glue)
        .replace(/\s+/g, " ")
        .trim();

    const completionTime = text("completion", " ");
    rows.push({
      completionTime,
      receiptNo: anchor.str.trim(),
      details: text("details", " "),
      transactionStatus: text("status", " "),
      paidIn: text("paidIn", ""),
      withdrawn: text("withdrawn", ""),
      balance: text("balance", ""),
    });
  });

  return { rows, headerFound: headers.length > 0, centres, direction };
}

/** Plain-text rendering of what was read, for the "show raw text" debug view. */
export function describeRows(rows: RawStatementRow[]): string[] {
  return rows.map(
    (r) =>
      `${r.receiptNo} | ${r.completionTime} | ${r.details} | ${r.transactionStatus} | in ${r.paidIn || "-"} | out ${r.withdrawn || "-"} | balance ${r.balance || "-"}`
  );
}

export { TIME_RE as PDF_TIME_RE, DATE_RE as PDF_DATE_RE };


// ---------------------------------------------------------------------
// Diagnostics for a PDF that opens but yields no rows. Names, phone
// numbers and amounts are MASKED (letters become a/A, digits become 9)
// so the shape of the layout can be shared without sharing the data.
// ---------------------------------------------------------------------
const STRUCTURAL_WORDS = new Set(
  [
    "receipt", "no.", "completion", "time", "details", "transaction", "status", "paid", "in", "withdrawn", "balance",
    "type", "other", "party", "completed", "account", "merchant", "payment", "online", "from", "pay", "charge", "with",
    "od", "stk", "via", "utility", "working", "charges", "mpesa", "statement", "records", "found.", "page", "of", "-",
  ]
);

export function maskText(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part) || STRUCTURAL_WORDS.has(part.toLowerCase())) return part;
      return part.replace(/[0-9]/g, "9").replace(/[a-z]/g, "a").replace(/[A-Z]/g, "A");
    })
    .join("");
}

export function describeItemsForDebug(pages: PdfTextItem[][], maxItems = 70): string {
  const totalItems = pages.reduce((n, p) => n + p.filter((i) => i.str.trim()).length, 0);
  const first = (pages[0] ?? []).filter((i) => i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const headerIndex = first.findIndex((i) => /receipt/i.test(i.str));
  const start = headerIndex > 4 ? headerIndex - 4 : 0;
  const sample = first
    .slice(start, start + maxItems)
    .map((i) => `${Math.round(i.x)}/${Math.round(i.y)}:${maskText(i.str.trim())}`)
    .join(" ; ");
  const wordsOnPage = splitIntoWords(pages[0] ?? []);
  const receiptLike = wordsOnPage.filter((w) => RECEIPT_RE.test(w.str)).length;
  const datesFound = wordsOnPage.filter((w) => DATE_RE.test(w.str)).length;
  return (
    `[Diagnostic: ${pages.length} page(s), ${totalItems} text pieces, ${receiptLike} receipt-like words and ` +
    `${datesFound} dates on page 1, header "Receipt" found: ${headerIndex >= 0 ? "yes" : "no"}. ` +
    `Layout sample (x/y:masked text): ${sample}]`
  );
}
