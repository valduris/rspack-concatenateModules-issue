// Minimal repro: optimization.concatenateModules:true drops the __webpack_require__.r(exports)
// interop call for css/module (exportType: "link") sources with rspack but not with webpack.

// Usage: npm install && node build.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import { fileURLToPath } from "node:url";
import webpack from "webpack";
import { rspack } from "@rspack/core";

const dir = path.dirname(fileURLToPath(import.meta.url));

// optimization.concatenateModules: true triggers the bug
const config = (outDir) => ({
    mode: "production",
    devtool: false,
    context: dir,
    entry: path.join(dir, "src/index.js"),
    output: { path: path.join(dir, outDir), filename: "bundle.js" },
    experiments: { css: true },
    module: {
        rules: [{ test: /\.css$/, type: "css/module" }],
        parser: { "css/module": { namedExports: false, exportType: "link" } },
    },
    optimization: { concatenateModules: true, minimize: false },
});

function evaluateInIsolatedContext(bundlePath) {
    const code = fs.readFileSync(bundlePath, "utf-8");
    const context = vm.createContext({ console });
    vm.runInContext(code, context);
}

function run(compiler, outDir) {
    return new Promise((resolve, reject) => {
        compiler.run((err, stats) => {
            if (err || stats.hasErrors()) {
                reject(err ?? new Error(stats.toString({ preset: "errors-only" })));
                return;
            }
            compiler.close(() => resolve(path.join(dir, outDir, "bundle.js")));
        });
    });
}

async function check(name, compiler, outDir) {
    const bundlePath = await run(compiler, outDir);
    try {
        evaluateInIsolatedContext(bundlePath);
        console.log(`${name}: OK - ${outDir}/bundle.js ran without error`);
    } catch (e) {
        console.log(`${name}: CRASHED - ${e.message} (${outDir}/bundle.js)`);
    }
}

await check("webpack", webpack(config("dist-webpack")), "dist-webpack");
await check("rspack", rspack(config("dist-rspack")), "dist-rspack");
