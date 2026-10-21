import { createEntryAcceptanceServer } from "./lib/entry-acceptance-browser-fixture.mjs";

const server = await createEntryAcceptanceServer();
console.log(`Entry acceptance fixture: ${server.base}/`);
process.stdin.resume();
const stop = async () => { await server.close(); process.exit(0); };
process.stdin.on("data", stop);
process.on("SIGINT", stop);
