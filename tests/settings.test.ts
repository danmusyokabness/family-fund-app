import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSettingsDefaults,
  mergeSettingsWithDefaults,
  validateSettingsInput,
  SETTINGS_SCHEMA,
} from "../lib/settings.ts";

test("getSettingsDefaults returns every schema key", () => {
  const defaults = getSettingsDefaults();
  for (const field of SETTINGS_SCHEMA) {
    assert.ok(field.key in defaults, `missing default for ${field.key}`);
  }
  assert.equal(defaults.target_amount, "300");
  assert.equal(defaults.fy_start_month, "8");
});

test("mergeSettingsWithDefaults fills in anything never saved", () => {
  const merged = mergeSettingsWithDefaults({ fund_name: "The Kariuki Fund" });
  assert.equal(merged.fund_name, "The Kariuki Fund");
  assert.equal(merged.target_amount, "300"); // untouched, falls back to default
});

test("validateSettingsInput accepts a complete, valid submission", () => {
  const input: Record<string, string> = {};
  for (const field of SETTINGS_SCHEMA) input[field.key] = field.default;
  input.fund_name = "The Kariuki Fund";
  input.till_number = "123456";

  const result = validateSettingsInput(input);
  assert.deepEqual(result.errors, {});
  assert.equal(result.values.fund_name, "The Kariuki Fund");
  assert.equal(result.values.till_number, "123456");
});

test("a required field left empty is an error", () => {
  const result = validateSettingsInput({ fund_name: "", till_number: "123456" });
  assert.ok("fund_name" in result.errors);
});

test("an optional field left empty falls back to its default, no error", () => {
  const result = validateSettingsInput({
    fund_name: "X",
    till_number: "123456",
    site_url: "",
  });
  assert.equal(result.errors.site_url, undefined);
  assert.equal(result.values.site_url, "");
});

test("a non-numeric integer field is rejected", () => {
  const result = validateSettingsInput({
    fund_name: "X",
    till_number: "123456",
    target_amount: "three hundred",
  });
  assert.ok(result.errors.target_amount.includes("whole number"));
});

test("an integer below its minimum is rejected", () => {
  const result = validateSettingsInput({ fund_name: "X", till_number: "1", target_amount: "0" });
  assert.ok(result.errors.target_amount.includes("at least"));
});

test("fy_start_month above 12 is rejected", () => {
  const result = validateSettingsInput({ fund_name: "X", till_number: "1", fy_start_month: "13" });
  assert.ok(result.errors.fy_start_month.includes("at most"));
});

test("a boolean field normalises common truthy/falsy spellings", () => {
  assert.equal(validateSettingsInput({ setup_complete: "true" }).values.setup_complete, "true");
  assert.equal(validateSettingsInput({ setup_complete: "on" }).values.setup_complete, "true");
  assert.equal(validateSettingsInput({ setup_complete: "false" }).values.setup_complete, "false");
  assert.equal(validateSettingsInput({ setup_complete: "" }).values.setup_complete, "false");
});

test("an unknown key in the input is silently ignored, not stored", () => {
  const input: Record<string, string> = { fund_name: "X", till_number: "1", not_a_real_setting: "hi" };
  const result = validateSettingsInput(input);
  assert.equal("not_a_real_setting" in result.values, false);
});