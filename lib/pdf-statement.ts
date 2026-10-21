// lib/pdf-statement.ts
//
// SERVER-ONLY. Opens an (optionally password-protected) M-PESA statement
// PDF with pdf.js-extract, hands the positioned text to lib/pdf-table.ts
// (which rebuilds the table rows the way a person reads them), and returns
// rows in the same shape the CSV importer produces.
//
// Two strategies, in order:
//   1. Table reader (lib/pdf-table.ts): uses the header row and each
//      receipt code to rebuild wrapped cells. This matches the real layout.
//   2. Line reader (lib/pdf-statement-line.ts): the original approach, kept
//      only as a fallback in case Safaricom ever changes the layout so that
//      a whole transaction sits on one line.
//
// If neither finds any transactions, a clear error explains why. The most
// likely cause is a PDF that is only a PICTURE of the statement (a
// screenshot, or a "print to PDF"/scan copy): it has no text for any
// program to read, so the original file straight from Safaricom (or the
// CSV) must be used instead.
//
// VERIFICATION, stated plainly: lib/pdf-table.ts is tested with text
// positions laid out exactly like a real statement. This file, which
// actually opens a PDF with pdf.js-extract, has still not been run
// against a real text-based statement, because the only real PDF
// available (21 Oct 2026) was a picture. The first original statement
// uploaded is the real test; use the "raw text" view to check it.

import { PDFExtract } from "pdf.js-extract";
import { parseStatementTextLine } from "./pdf-statement-line.ts";
import { describeRows, readTablePage, type PdfTextItem } from "./pdf-table.ts";
import type { RawStatementRow } from "./statement-parser.ts";

const Y_CLUSTER_TOLERANCE = 3;

export interface PdfStatementResult {
  rawRows: RawStatementRow[];
  /** What was read, one line each, so a bad read is visible in the preview instead of silent. */
  lines: string[];
  /** Which strategy found the rows. */
  method: "table" | "lines";
}

interface PageItems {
  items: PdfTextItem[];
}

function linesFromItems(page: PageItems): string[] {
  const items = page.items.filter((i) => i.str && i.str.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: string[] = [];
  let currentY: number | null = null;
  let current: PdfTextItem[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const text = current
      .sort((a, b) => a.x - b.x)
      .map((i) => i.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push(text);
    current = [];
  };
  for (const item of items) {
    if (currentY === null || Math.abs(item.y - currentY) <= Y_CLUSTER_TOLERANCE) {
      current.push(item);
      currentY = currentY ?? item.y;
    } else {
      flush();
      current = [item];
      currentY = item.y;
    }
  }
  flush();
  return lines;
}

export async function extractStatementRowsFromPdf(buffer: Buffer, password?: string): Promise<PdfStatementResult> {
  const pdfExtract = new PDFExtract();
  const data = await pdfExtract.extractBuffer(buffer, password ? { password } : {});

  const pages: PageItems[] = data.pages.map((page) => ({
    items: (page.content as { str: string; x: number; y: number; width?: number }[]).map((c) => ({
      str: c.str,
      x: c.x,
      y: c.y,
      width: c.width,
    })),
  }));

  // ---- Strategy 1: the table reader --------------------------------------
  const tableRows: RawStatementRow[] = [];
  let fallback: Parameters<typeof readTablePage>[1] = undefined;
  for (const page of pages) {
    const result = readTablePage(page.items, fallback);
    tableRows.push(...result.rows);
    fallback = { centres: result.centres, direction: result.direction };
  }
  if (tableRows.length > 0) {
    return { rawRows: tableRows, lines: describeRows(tableRows), method: "table" };
  }

  // ---- Strategy 2: whole transaction on one line -------------------------
  const allLines = pages.flatMap(linesFromItems);
  const lineRows: RawStatementRow[] = [];
  for (const line of allLines) {
    const row = parseStatementTextLine(line);
    if (row) lineRows.push(row);
  }
  if (lineRows.length > 0) {
    return { rawRows: lineRows, lines: allLines, method: "lines" };
  }

  // ---- Nothing found: explain why ------------------------------------------
  const totalItems = pages.reduce((n, p) => n + p.items.filter((i) => i.str.trim()).length, 0);
  const sawHeader = allLines.some((l) => /Receipt No/i.test(l));
  if (!sawHeader && totalItems < 200) {
    throw new Error(
      "This PDF contains almost no readable text, so it is probably a picture of the statement (a screenshot, a scan, or a " +
        "\"print to PDF\" copy). Programs cannot read the table from a picture. Please upload the original PDF straight from " +
        "Safaricom (the one that asks for a password), or upload the statement as a CSV."
    );
  }
  throw new Error(
    "The PDF opened, but no transactions were found in it. Check that it is an M-PESA statement for the Till, or upload it as a CSV instead."
  );
}
