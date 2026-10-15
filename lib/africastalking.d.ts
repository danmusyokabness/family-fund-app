// lib/africastalking.d.ts
//
// The 'africastalking' package ships no TypeScript types of its own,
// and there's no @types/africastalking package either. Without this
// file, strict mode (which this project uses) refuses to build at all
// rather than silently treating it as untyped. This one line says
// "trust the shape used in lib/sms.ts" without pretending to know the
// package's full API.

declare module "africastalking";
