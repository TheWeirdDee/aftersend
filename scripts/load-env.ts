// Side-effect import: `import "./load-env";` makes values from .env.local visible to a script.
import { loadLocalEnv } from "./env-file";

loadLocalEnv();
