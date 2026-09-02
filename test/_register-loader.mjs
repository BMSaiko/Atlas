// ponytail: register the test ts-loader so --test resolves extensionless
// .ts imports from server/*. the harness does the same thing itself
// (see _atlas-runtime.mjs); this shim is for the pure --test path.
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
const here = dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(join(here, "_ts-loader.mjs")).href)
