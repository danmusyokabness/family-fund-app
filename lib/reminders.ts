// lib/reminders.ts
//
// Works out which members should get the 7th reminder (anyone with a
// balance above zero, this month and every month before it — D10/D11 in
// the project plan) and what their message says. Pure: takes plain data
// in, returns plain data out. The cron route loads the real data and
// actually sends; app/api/admin/reminders/preview wraps this same logic
// for the dry-run view in the admin UI.

import { computeMemberLedger, summarizeUnpaidMonths } from "./ledger.ts";
import { monthKeyFromDateString, type MonthKey } from "./dates.ts";
import { fillTemplate } from "./message-templates.ts";

export interface ReminderMemberInput {
  id: string;
  fullName: string;
  joinedOn: string; // "YYYY-MM-DD"
  primaryPhone: string | null;
}

export interface ReminderCandidate {
  memberId: string;
  fullName: string;
  phone: string;
  balance: number;
  unpaidSummary: string;
}

export interface SkippedMember {
  memberId: string;
  fullName: string;
  reason: "no_phone" | "no_balance_due";
}

export interface BuildRemindersResult {
  candidates: ReminderCandidate[];
  skipped: SkippedMember[];
}

export function buildReminderCandidates(input: {
  members: ReminderMemberInput[];
  allocatedByMember: Record<string, number>;
  targetAmount: number;
  asOfMonth: MonthKey;
}): BuildRemindersResult {
  const candidates: ReminderCandidate[] = [];
  const skipped: SkippedMember[] = [];

  for (const m of input.members) {
    const ledger = computeMemberLedger({
      joinedOn: monthKeyFromDateString(m.joinedOn),
      targetAmount: input.targetAmount,
      totalAllocated: input.allocatedByMember[m.id] ?? 0,
      asOfMonth: input.asOfMonth,
    });

    if (ledger.balance <= 0) {
      skipped.push({ memberId: m.id, fullName: m.fullName, reason: "no_balance_due" });
      continue;
    }
    if (!m.primaryPhone) {
      skipped.push({ memberId: m.id, fullName: m.fullName, reason: "no_phone" });
      continue;
    }

    candidates.push({
      memberId: m.id,
      fullName: m.fullName,
      phone: m.primaryPhone,
      balance: ledger.balance,
      unpaidSummary: summarizeUnpaidMonths(ledger.unpaidMonths),
    });
  }

  return { candidates, skipped };
}

export function composeReminderMessage(
  template: string,
  params: { fundName: string; fullName: string; balance: number; unpaidSummary: string; tillNumber: string; siteUrl: string }
): string {
  const firstName = params.fullName.trim().split(/\s+/)[0] ?? params.fullName;
  return fillTemplate(template, {
    fund_name: params.fundName,
    first_name: firstName,
    balance: String(Math.round(params.balance)),
    unpaid_months: params.unpaidSummary,
    till_number: params.tillNumber,
    site_url: params.siteUrl,
  });
}
