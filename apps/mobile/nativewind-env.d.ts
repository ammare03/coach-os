/// <reference types="nativewind/types" />

// TS 6's `noUncheckedSideEffectImports` defaults to on (`!== false` in the
// compiler source, not `=== true`) and fails a side-effect-only import that
// resolves to nothing — `_layout.tsx`'s `import '../global.css'`
// (theme-tokens/01) needs this ambient declaration to satisfy it. Empty
// body — the import is side-effect-only, nothing reads a value from it, and
// a default export would trip `import/no-default-export`.
declare module '*.css';
