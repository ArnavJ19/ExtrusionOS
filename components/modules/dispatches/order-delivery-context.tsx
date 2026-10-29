"use client";
import { useEffect, useState } from "react";
import { downstreamContextAction } from "@/lib/actions/downstream-context";
import type { DownstreamContext } from "@/lib/workflow/downstream-context";
import { Button } from "@/components/ui/button";
export function OrderDeliveryContext({ orderId, dispatchId }: { orderId: string; dispatchId?: string }) {
  const [state, setState] = useState<{ data?: DownstreamContext; error?: string }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true; setState({});
    void downstreamContextAction({ order_id: orderId, ...(dispatchId ? { dispatch_id: dispatchId } : {}) }).then(result => {
      if (current) setState(result.success ? { data: result.data } : { error: result.error });
    }).catch(() => { if (current) setState({ error: "Delivery details are unavailable." }); });
    return () => { current = false; };
  }, [orderId, dispatchId, retry]);
  return <section aria-label="Order delivery details" className="min-w-0 rounded-2xl border bg-white p-4 text-sm">
    <h2 className="font-bold">Delivery details from the selected order</h2>
    {state.error ? <div role="alert"><p>{state.error}</p><Button type="button" variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry delivery details</Button></div>
      : state.data ? <div className="mt-2 space-y-1 break-words"><p className="font-semibold">{state.data.party.customer_name}</p>
        <p>{state.data.party.site_name}</p><p>{state.data.party.delivery_address || "Delivery address was not captured. Verify it with the order owner."}</p>
        <p>{[state.data.party.contact_name, state.data.party.contact_phone].filter(Boolean).join(" / ")}</p>
        {state.data.party.instructions ? <p>{state.data.party.instructions}</p> : null}
        <p className="pt-2 text-xs text-slate-500">{state.data.basis}. {state.data.immutable ? "Recorded with this dispatch." : "These details are recorded when dispatch is confirmed."}</p>
      </div> : <p role="status" className="mt-2">Loading order delivery details...</p>}
  </section>;
}
