// lib/settings.ts
//
// The fund's configuration lives in the `settings` table as plain
// key/value text rows (see db/001_schema.sql) — deliberately NOT
// hard-coded anywhere, per the project's rule 11. This file is the one
// place that knows which keys exist, their defaults, and how to
// validate a value for each — so the Setup page's API route and any
// future code that reads settings agree on the same rules.

export type SettingType = "string" | "text" | "integer" | "boolean";

export interface SettingField {
  key: string;
  label: string;
  type: SettingType;
  default: string;
  required: boolean;
  min?: number; // for "integer"
  max?: number; // for "integer"
  helpText?: string;
}

export const SETTINGS_SCHEMA: SettingField[] = [
  {
    key: "fund_name",
    label: "Fund name",
    type: "string",
    default: "Family Emergency Fund",
    required: true,
    helpText: "Shown on the login page and at the start of every SMS.",
  },
  {
    key: "till_number",
    label: "M-PESA Till number",
    type: "string",
    default: "",
    required: true,
    helpText: "The number members actually pay to (not a separate store number, if your Till has one).",
  },
  {
    key: "target_amount",
    label: "Monthly contribution target (KES)",
    type: "integer",
    default: "300",
    required: true,
    min: 1,
    max: 1_000_000,
  },
  {
    key: "fy_start_month",
    label: "Financial year start month (1-12)",
    type: "integer",
    default: "8", // August
    required: true,
    min: 1,
    max: 12,
    helpText: "8 = August, matching the fund's actual financial year.",
  },
  {
    key: "reminder_day",
    label: "Day of the month to send arrears reminders",
    type: "integer",
    default: "7",
    required: true,
    min: 1,
    max: 28, // stays valid in every month, including February
  },
  {
    key: "report_day",
    label: "Day of the month to send the fund report",
    type: "integer",
    default: "15",
    required: true,
    min: 1,
    max: 28,
  },
  {
    key: "site_url",
    label: "Site link (included in SMS messages)",
    type: "string",
    default: "",
    required: false,
  },
  {
    key: "reminder_message_template",
    label: "7th reminder message",
    type: "text",
    default:
      "{fund_name}: Hi {first_name}, your balance is KES {balance} (unpaid: {unpaid_months}). " +
      "Please pay to Till {till_number}. Thank you. {site_url}",
    required: true,
    helpText: "Placeholders: {fund_name} {first_name} {balance} {unpaid_months} {till_number} {site_url}",
  },
  {
    key: "report_message_template",
    label: "15th fund report message",
    type: "text",
    default:
      "{fund_name} {date}: collected this month KES {month_collected}. " +
      "Total in account KES {fund_total}. Your balance: KES {balance} owing. {site_url}",
    required: true,
    helpText:
      "Placeholders: {fund_name} {date} {month_collected} {fund_total} {balance} {site_url}",
  },
  {
    key: "setup_complete",
    label: "Setup complete",
    type: "boolean",
    default: "false",
    required: false,
  },
];

export function getSettingsDefaults(): Record<string, string> {
  const defaults: Record<string, string> = {};
  for (const field of SETTINGS_SCHEMA) defaults[field.key] = field.default;
  return defaults;
}

/** Merges stored key/value rows over the defaults, so a never-saved key still has a sensible value. */
export function mergeSettingsWithDefaults(stored: Record<string, string>): Record<string, string> {
  return { ...getSettingsDefaults(), ...stored };
}

export interface ValidateSettingsResult {
  values: Record<string, string>; // only present for fields with no error
  errors: Record<string, string>; // key -> human-readable message
}

/**
 * Validates a raw form submission (every value as a string, as it comes
 * from an HTML form or a JSON body) against the schema above. Unknown
 * keys in the input are ignored, not stored — the schema is the only
 * source of truth for which settings exist.
 */
export function validateSettingsInput(input: Record<string, string>): ValidateSettingsResult {
  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};

  for (const field of SETTINGS_SCHEMA) {
    const raw = (input[field.key] ?? "").toString().trim();

    if (!raw) {
      if (field.required) {
        errors[field.key] = `${field.label} is required.`;
      } else {
        values[field.key] = field.default;
      }
      continue;
    }

    if (field.type === "integer") {
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        errors[field.key] = `${field.label} must be a whole number.`;
        continue;
      }
      if (field.min !== undefined && n < field.min) {
        errors[field.key] = `${field.label} must be at least ${field.min}.`;
        continue;
      }
      if (field.max !== undefined && n > field.max) {
        errors[field.key] = `${field.label} must be at most ${field.max}.`;
        continue;
      }
      values[field.key] = String(n);
    } else if (field.type === "boolean") {
      values[field.key] = raw === "true" || raw === "on" || raw === "1" ? "true" : "false";
    } else {
      // "string" and "text" both just get trimmed and stored as-is.
      values[field.key] = raw;
    }
  }

  return { values, errors };
}