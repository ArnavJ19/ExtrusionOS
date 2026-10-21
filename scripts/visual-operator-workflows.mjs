import { createOperatorBrowserFixture } from "./lib/operator-browser-fixture.mjs";

const fixture = await createOperatorBrowserFixture();
await fixture.seedQuoteAliases();
process.stdout.write(`Operator workflow acceptance: ${fixture.base}/customer\nQuotation alias acceptance: ${fixture.base}/quote\nPromise queue: ${fixture.base}/tasks/commitments\nSynthetic auth and disposable local data only. Any stdin input closes the fixture.\n`);
let closing = false;
async function close() { if (closing) return; closing = true; await fixture.close(); process.exit(0); }
process.stdin.resume(); process.stdin.once("data", close); process.once("SIGINT", close); process.once("SIGTERM", close);
