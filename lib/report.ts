// lib/report.ts
//
// The 15th-of-the-month fund report (decision D11). Everyone with a
// phone gets ONE text: how much was collected this month, the total in
// the account, and their OWN balance. Other members' names and amounts
// are never included. Pure: takes plain data in, returns plain data out;
// the cron route loads the data and sends.
//
// Wording comes from the "15th fund report message" setting (editable in
// Setup). Besides the placeholders listed there, two optional extras can
// be used in a custom message: {balance_line} (either "Your balance: KES
// 600 owing." or "Your account is up to date. Thank you!") and
// {pending_note} (empty, or "A payment from you is being confirmed.").
//
// Two rules are applied automatically so nobody gets a misleading text:
//   * A member who owes nothing never sees "balance: KES 0 owing": the
//     default balance sentence is swapped for "Your account is up to date."
//   * A member with a payment awaiting the admin's confirmation gets a
//     short "a payment is being confirmed" note, because their balance
//     may look too high until it is confirmed.

import { computeMemberLedger } from "./ledger.ts";
import { monthKeyFromDateString, type MonthKey } from "./dates.ts";
import { fillTemplate } from "./message-templates.ts";

export interface ReportMemberInput {
  id: string;
  fullName: string;
  joinedOn: string; // "YYYY-MM-DD"
  primaryPhone: string | null;
}

export interface ReportMessage {
  memberId: string;
  fullName: string;
  /** Null when the member has no phone: nothing can be sent, the admin is told. */
  phone: string | null;
  message: string;
  balance: number;
  hasPendingPayment: boolean;
  /** How many SMS segments this message will cost (160 characters each, 153 once it needs more than one). */
  segments: number;
}

export interface BuildReportInput {
  members: ReportMemberInput[];
  allocatedByMember: Record<string, number>;
  targetAmount: number;
  asOfMonth: MonthKey;
  /** Cash collected this month, from the same figure the dashboard shows. */
  monthCollected: number;
  /** Real fund balance, from the same figure the dashboard shows. */
  fundTotal: number;
  /** Members who have a payment waiting for the admin to confirm. */
  pendingMemberIds: Set<string>;
  template: string;
  fundName: string;
  /** "YYYY-MM-DD", the day the report is for (today, Nairobi time). */
  reportDate: string;
  siteUrl: string;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-15" -> "15 Oct 2026". Returns the input unchanged if it is not a date. */
export function formatReportDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return date;
  return `${Number(m[3])} ${MONTH_NAMES[month - 1]} ${m[1]}`;
}

/** Whole shillings with thousands separators: 12064.86 -> "12,065". Never uses the computer's locale. */
export function formatKes(amount: number): string {
  const whole = Math.round(amount);
  const sign = whole < 0 ? "-" : "";
  return sign + String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** SMS segments: up to 160 characters is 1; longer messages are 153 per segment. */
export function smsSegments(message: string): number {
  const length = [...message].length;
  if (length === 0) return 0;
  return length <= 160 ? 1 : Math.ceil(length / 153);
}

const DEFAULT_BALANCE_SENTENCE = /Your balance: KES \{balance\} owing\./;

export function composeReportMessage(params: {
  template: string;
  fundName: string;
  reportDate: string;
  monthCollected: number;
  fundTotal: number;
  balance: number;
  hasPendingPayment: boolean;
  siteUrl: string;
}): string {
  const owes = params.balance > 0;
  const balanceLine = owes ? `Your balance: KES ${formatKes(params.balance)} owing.` : "Your account is up to date. Thank you!";
  const pendingNote = params.hasPendingPayment ? "A payment from you is being confirmed." : "";

  let template = params.template;
  // The standard wording says "owing", which would be wrong for someone who owes nothing.
  if (!owes) template = template.replace(DEFAULT_BALANCE_SENTENCE, "{balance_line}");

  let message = fillTemplate(template, {
    fund_name: params.fundName,
    date: formatReportDate(params.reportDate),
    month_collected: formatKes(params.monthCollected),
    fund_total: formatKes(params.fundTotal),
    balance: formatKes(params.balance),
    balance_line: balanceLine,
    pending_note: pendingNote,
    site_url: params.siteUrl,
  });

  // The note is added automatically unless the wording already places it.
  if (params.hasPendingPayment && !template.includes("{pending_note}")) {
    message = `${message} ${pendingNote}`;
  }
  return message.replace(/\s+/g, " ").trim();
}

export function buildReportMessages(input: BuildReportInput): ReportMessage[] {
  return input.members.map((m) => {
    const ledger = computeMemberLedger({
      joinedOn: monthKeyFromDateString(m.joinedOn),
      targetAmount: input.targetAmount,
      totalAllocated: input.allocatedByMember[m.id] ?? 0,
      asOfMonth: input.asOfMonth,
    });
    const hasPendingPayment = input.pendingMemberIds.has(m.id);
    const message = composeReportMessage({
      template: input.template,
      fundName: input.fundName,
      reportDate: input.reportDate,
      monthCollected: input.monthCollected,
      fundTotal: input.fundTotal,
      balance: ledger.balance,
      hasPendingPayment,
      siteUrl: input.siteUrl,
    });
    return {
      memberId: m.id,
      fullName: m.fullName,
      phone: m.primaryPhone,
      message,
      balance: ledger.balance,
      hasPendingPayment,
      segments: smsSegments(message),
    };
  });
}
