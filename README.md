# rspack: `concatenateModules` drops the `__webpack_require__.r(exports)` interop call for `css/module` sources

Minimal reproduction for a bug found while migrating a large monorepo's webpack build to rspack. The same exact
config, compiled by both bundlers side by side: webpack handles it correctly, rspack does not.

## Environment

- `@rspack/core`: 2.2.2 (also reproduced on 2.2.0)
- `webpack`: 5.108.4 (for comparison, unpatched)
- Node: 22.18.0

## Reproduction

```bash
npm install
node build.mjs
```

## Summary

With `optimization.concatenateModules: true`, a `css/module` source (`parser: { "css/module": { exportType: "link" } }`)
that gets merged into a concatenated scope keeps an unrewritten `__webpack_require__.r(exports)` call - `exports` is
never declared anywhere in the concatenated scope (only `__webpack_exports__` is), so evaluating the bundle in any
real ESM/browser context throws:

```
ReferenceError: exports is not defined
```

webpack, given the identical config (module rules, parser options, `experiments.css: true`, `concatenateModules: true`),
does **not** have this problem - it correctly rewrites/omits the interop call when concatenating the same source.

Running the rspack bundle via plain `node bundle.js` does **not** reproduce the crash - it appears to work only
because Node's own CommonJS module wrapper happens to inject an unrelated `exports` object into scope for every
`.js` file it loads. That's a false negative, not evidence the generated code is correct: this repro evaluates each
bundle in a genuinely fresh `vm` context (no ambient `exports`, matching a browser `<script>` or a real ESM module)
to reliably reproduce the crash.

### Source under test

```js
// src/style.css
.foo { color: red; }

// src/moduleA.js
import styles from "./style.css";
export default function getClassName() { return styles.foo; }

// src/index.js
import getClassName from "./moduleA.js";
console.log(getClassName());
```

### Config (identical for both bundlers, see `build.mjs`)

```js
{
    mode: "production",
    experiments: { css: true },
    module: {
        rules: [{ test: /\.css$/, type: "css/module" }],
        parser: { "css/module": { namedExports: false, exportType: "link" } },
    },
    optimization: { concatenateModules: true },
}
```

## Actual rspack output (`concatenateModules: true`)

Inside the concatenated scope:

```js
var __webpack_exports__ = {};

;// CONCATENATED MODULE: ./src/style.css
__webpack_require__.r(exports);        // <-- `exports` is never declared anywhere in this scope
var p = "ekbvN-";

;// CONCATENATED MODULE: ./src/moduleA.js
function getClassName() {
    return p;
}

;// CONCATENATED MODULE: ./src/index.js
console.log(getClassName());
```

## For comparison: rspack output with `concatenateModules: false`

The same `css/module` source is emitted as its own separate module function, and never calls `.r()` at all -
it's treated as a plain module with a `module.exports` assignment instead:

```js
127(module) {
var exports = {
  "p": "ekbvN-",
};

module.exports = exports;
},
```

So the errant `.r(exports)` call is specific to, and only breaks under, rspack's concatenated code path - it looks
like concatenation reuses a per-module codegen template for `css/module`/`exportType: "link"` sources that assumes
the module's own `(module, exports, require)` function-wrapper parameters are still in scope, without rewriting or
removing that call when the module is inlined into a shared scope instead. webpack's own concatenation of the
identical source does not have this problem.

## Expected

Either the `.r()` interop call should be rewritten to reference the concatenated scope's real exports binding
(`__webpack_exports__`), or omitted entirely for a concatenated `css/module` source, consistent with how normal
JS modules (`moduleA.js`, `index.js` above) are correctly concatenated with no dangling references, and consistent
with webpack's own behavior for the identical source and config.

## Workaround

Disable `optimization.concatenateModules` whenever any `css/module` (`exportType: "link"`) sources are present in
the build.

## Files

- `src/` - the source under test (see above).
- `build.mjs` - builds `src/` with both webpack and rspack under the identical config, then evaluates each output
  bundle in an isolated context and reports pass/fail for each.
