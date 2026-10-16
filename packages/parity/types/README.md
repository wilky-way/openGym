# Saxes declaration compatibility

The full `saxes@6.0.0` declaration API is retained here under its [upstream license](https://github.com/lddubeau/saxes/blob/v6.0.0/LICENSE), reproduced in `SAXES-LICENSE`.

Original `saxes.d.ts` SHA-256: `a795d722f71f114bbb73ad6fbde87c11e3b64af808f91183e1db601ff456d37f`.
Original `saxes.js` SHA-256: `d00e2ba27ed7d6ac961d03ff14d6b8c0eb5bf063ed2c996c22c6df06ac121423`.

Five generic parameters gain the same `O extends SaxesOptions` bound already required by their referenced types: `OpenTagStartHandler`, `AttributeHandler`, `OpenTagHandler`, `CloseTagHandler`, and `EventNameToHandler`. A parity-only TypeScript path selects this complete external-module declaration; runtime module resolution still selects the original JavaScript. All exported APIs, defaults, conditional namespace payloads, and private class fields remain.

This package includes the declaration for strict TypeScript checking without changing runtime module resolution, dependency versions, or `skipLibCheck`. The boundary checker accepts only this exact canonical declaration and SHA from its existing `scripts/test-execution.ts` helper edge, while independently checking the installed runtime package. The runtime remains the installed `saxes@6.0.0`. `test/saxes-compat.typecheck.ts` checks valid and deliberately invalid API usage. The original package declaration has four TS2344 errors under the current strict compiler; these corrected full declarations do not assert that the original declarations pass.
