import { createCollaborationBrowserFixture } from "./lib/collaboration-browser-fixture.mjs";
import { ids, id } from "./lib/collaboration-workflow-fixture.mjs";
const fixture = await createCollaborationBrowserFixture();
await fixture.seed();
await fixture.command("discussions.post", { entity_type: "order", entity_id: ids.order, body: "Use drawing revision B for the next production handover.", reference: "Approved drawing B / sample reviewed", mentions: [ids.colleague], reply_to: null, request_id: id(1100) });
console.log(JSON.stringify({ base: fixture.base, procedure: `/tasks/procedures/${id(1000)}`, routine: `/tasks/routines/${id(2000)}`, proof: "Actual components and actions; synthetic auth and disposable PGlite only" }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await fixture.close(); process.exit(0); });
