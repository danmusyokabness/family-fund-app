// lib/message-templates.ts
//
// Fills {placeholder} tokens in a settings-defined message template. A
// placeholder with no matching value is left exactly as written, rather
// than silently disappearing — so a typo in Setup's wording is visible,
// not swallowed.

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}
