import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf.js (inside pdf.js-extract, used by lib/pdf-statement.ts) has an
  // optional page-rendering path that needs the native 'canvas' package.
  // This project only extracts text, never renders a page as an image,
  // so that path is never reached — but Turbopack still fails trying to
  // resolve it ahead of time unless it's aliased to something real.
  // See lib/canvas-stub.js for the full explanation.
  //
  // This must be a plain relative path with forward slashes, NOT an
  // OS-native absolute path (e.g. via path.resolve/__dirname) — on
  // Windows that produces a backslash path Turbopack's resolveAlias
  // rejects with "windows imports are not implemented yet".
  turbopack: {
    resolveAlias: {
      canvas: "./lib/canvas-stub.js",
    },
  },
};

export default nextConfig;
