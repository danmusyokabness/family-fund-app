// lib/pdf-statement.ts
//
// SERVER-ONLY. Opens an (optionally password-protected) PDF statement,
// reconstructs each visual line of text from the positions PDF.js
// reports for every text fragment on the page (grouping fragments with
// a similar vertical position into one line, left-to-right), and hands
// each line to the already-tested parseStatementTextLine().
//
// HONESTLY FLAGGED: this file could not be run against a real M-PESA
// statement PDF while building it — none was available. The line
// clustering tolerance and the assumption that PDF.js reports text top
// to bottom are both reasonable defaults, not confirmed facts about
// this specific statement's layout. The import route below returns the
// raw reconstructed lines alongside the parsed result specifically so
// a human can sanity-check what was actually read before trusting it —
// treat the very first real PDF you upload as a test, not a done deal,
// and compare its preview against the statement by eye.

import { PDFExtract } from "pdf.js-extract";
import { parseStatementTextLine } from "./pdf-statement-line";
import type { RawStatementRow } from "./statement-parser";

const Y_CLUSTER_TOLERANCE = 3;

interface ExtractedItem {
  str: string;
  x: number;
  y: number;
}

export interface PdfStatementResult {
  rawRows: RawStatementRow[];
  /** Every reconstructed line, in reading order — shown in the preview so a bad read is visible, not silent. */
  lines: string[];
}

export async function extractStatementRowsFromPdf(buffer: Buffer, password?: string): Promise<PdfStatementResult> {
  const pdfExtract = new PDFExtract();
  const data = await pdfExtract.extractBuffer(buffer, password ? { password } : {});

  const lines: string[] = [];

  for (const page of data.pages) {
    const items = (page.content as ExtractedItem[])
      .filter((i) => i.str && i.str.trim())
      .sort((a, b) => a.y - b.y || a.x - b.x);

    let currentY: number | null = null;
    let currentLine: ExtractedItem[] = [];

    const flush = () => {
      if (currentLine.length === 0) return;
      const text = currentLine
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) lines.push(text);
      currentLine = [];
    };

    for (const item of items) {
      if (currentY === null || Math.abs(item.y - currentY) <= Y_CLUSTER_TOLERANCE) {
        currentLine.push(item);
        currentY = currentY ?? item.y;
      } else {
        flush();
        currentLine = [item];
        currentY = item.y;
      }
    }
    flush();
  }

  const rawRows: RawStatementRow[] = [];
  for (const line of lines) {
    const row = parseStatementTextLine(line);
    if (row) rawRows.push(row);
  }

  return { rawRows, lines };
}
