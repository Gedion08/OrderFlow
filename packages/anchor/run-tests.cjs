const path = require("path");
const fs = require("fs");
const ts = require("typescript");
const Mocha = require("mocha");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2019,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const mocha = new Mocha({ timeout: 1_000_000 });
mocha.addFile(path.join(__dirname, "tests/orderflow.ts"));
mocha.run((failures) => {
  process.exitCode = failures ? 1 : 0;
});
