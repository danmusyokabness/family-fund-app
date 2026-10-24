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

  // Security headers on every page and every API reply.
  //   * X-Frame-Options / frame-ancestors: nobody can put this site inside
  //     another page (clickjacking).
  //   * nosniff, Referrer-Policy, Permissions-Policy: browser safety defaults.
  //   * Strict-Transport-Security: browsers insist on HTTPS from now on.
  //   * X-Robots-Tag: this is a private family site, so search engines are
  //     told not to list it.
  // The Content-Security-Policy is deliberately small (it does not restrict
  // scripts, which Next.js needs to run its own inline ones): it blocks
  // framing, plugin content and form posts to other sites.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
