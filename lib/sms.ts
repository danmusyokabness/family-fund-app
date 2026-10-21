// lib/sms.ts
//
// SERVER-ONLY. Thin wrapper around Africa's Talking. Controlled entirely
// by SMS_LIVE: while it's false (the default), nothing is actually sent
// — every call succeeds as a logged dry run, so the reminder/report
// logic can be built, tested and watched in the admin UI before a
// single real text goes out. Only once AT_API_KEY/AT_USERNAME are set
// AND SMS_LIVE=true does a message really leave.

import { serverEnv } from "./env.ts";
import { normalizePhone } from "./phone.ts";

/**
 * Africa's Talking wants international format WITH a plus sign
 * (+254712345678). The database stores 254712345678, so the plus is
 * added here, in the one place that talks to the provider. Returns null
 * if the number is not a recognisable Kenyan mobile number.
 */
export function toProviderPhone(phone: string): string | null {
  const canonical = normalizePhone(phone);
  return canonical ? `+${canonical}` : null;
}

export interface SendSmsResult {
  ok: boolean;
  dryRun: boolean;
  providerResponse?: unknown;
  error?: string;
}

export async function sendSms(toPhone: string, message: string): Promise<SendSmsResult> {
  const env = serverEnv();

  if (!env.smsLive) {
    return { ok: true, dryRun: true };
  }

  if (!env.atApiKey || !env.atUsername) {
    return { ok: false, dryRun: false, error: "Africa's Talking is not configured (AT_API_KEY / AT_USERNAME missing)." };
  }

  const providerPhone = toProviderPhone(toPhone);
  if (!providerPhone) {
    return { ok: false, dryRun: false, error: `"${toPhone}" is not a valid Kenyan mobile number.` };
  }

  try {
    // Required at call time, not at module load, so this file can be
    // imported (and its dry-run path used) even before the dependency
    // is needed for anything real.
    const africastalking = (await import("africastalking")).default({
      apiKey: env.atApiKey,
      username: env.atUsername,
    });

    const options: Record<string, unknown> = { to: [providerPhone], message };
    if (env.atSenderId) options.from = env.atSenderId;

    const response = await africastalking.SMS.send(options);
    return { ok: true, dryRun: false, providerResponse: response };
  } catch (err) {
    return { ok: false, dryRun: false, error: err instanceof Error ? err.message : String(err) };
  }
}
