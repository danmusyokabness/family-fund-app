// lib/canvas-stub.js
//
// pdf.js (used by pdf.js-extract for reading PDF statements) has an
// OPTIONAL code path that renders a PDF page as an image, which needs
// the native 'canvas' package. This project only ever extracts TEXT
// (see lib/pdf-statement.ts), so that code path is never reached — but
// Turbopack still tries to resolve the `require("canvas")` call ahead
// of time during the build and fails, since 'canvas' isn't installed
// (it needs native build tools, which would only be worth the cost if
// this project ever actually rendered a PDF page as an image).
//
// next.config.ts aliases 'canvas' to this file instead, so the build
// succeeds. If createCanvas is ever actually called, it throws a clear
// error rather than silently returning something broken — that would
// mean a future change started relying on the image-rendering path,
// which needs the real 'canvas' package installed properly, not this stub.

function createCanvas() {
  throw new Error(
    "lib/canvas-stub.js: createCanvas() was actually called. This project only uses pdf.js for text " +
      "extraction, not page rendering, so this should never happen. If something now needs it, install " +
      "the real 'canvas' package and remove this alias from next.config.ts."
  );
}

module.exports = { createCanvas };
