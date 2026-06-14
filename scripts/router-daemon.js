#!/usr/bin/env node
// Detached worker process for the slim model router. The CLI (`slim router
// start`) spawns this; all it does is run the proxy server in the foreground.
// Lifecycle (start/stop/status/settings swap) lives in the CLI + lib/router.js.
import { runServer } from "./lib/router.js";

runServer();
