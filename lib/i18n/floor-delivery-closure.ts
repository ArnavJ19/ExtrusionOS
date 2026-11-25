// Orchestration Phase 7: English and Hindi labels the floor screens show for the delivery and closure work — the Phase 7
// task kinds in the workflow task inbox, their work links, the closure states and the lifecycle ledger line. Spread into
// the floor catalogue (lib/i18n/floor.ts), so the same English / हिंदी toggle, placeholder rules and parity test apply.
// The delivery, complaint, payment and closure screens themselves are office screens in English.

export const DELIVERY_CLOSURE_EN = {
  // ---------------------------------------------------------------- task kinds and work links
  "olo.kind.delivery_discrepancy": "Delivery discrepancy",
  "olo.kind.complaint_investigation": "Investigate a customer complaint",
  "olo.kind.complaint_resolution": "Agree a complaint resolution",
  "olo.kind.complaint_replacement": "Plan complaint replacement",
  "olo.kind.complaint_credit_note": "Credit note for a complaint",
  "olo.kind.complaint_closure": "Verify and close a complaint",
  "olo.kind.payment_followup": "Customer payment follow-up",
  "olo.kind.closure_review": "Operational closure review",
  "olo.kind.final_closure": "Final order closure",
  "olo.work.delivery_discrepancy": "Resolve the discrepancy",
  "olo.work.complaint_investigation": "Open the complaint",
  "olo.work.complaint_resolution": "Open the complaint",
  "olo.work.complaint_replacement": "Open the complaint",
  "olo.work.complaint_credit_note": "Open the complaint",
  "olo.work.complaint_closure": "Open the complaint",
  "olo.work.payment_followup": "Follow up the payment",
  "olo.work.closure_review": "Review the closure",
  "olo.work.final_closure": "Review the closure",
  // ---------------------------------------------------------------- order lifecycle
  "olo.lc.overall.operationally_fulfilled": "Operationally fulfilled — closure review due",
  "olo.lc.overall.operationally_closed_financially_settled": "Operationally closed — financially settled",
  "olo.lc.overall.partially_closed_by_authorization": "Partially closed by authorisation",
  "olo.lc.l.replacement": "Replacement dispatched",
  "olo.lc.s.replacement": "Complaint replacements (not order quantity)",
  "olo.lc.closureRecord": "Closure record",
  "olo.lc.closureBoard": "Order closure"
} as const;

export type DeliveryClosureKey = keyof typeof DELIVERY_CLOSURE_EN;

export const DELIVERY_CLOSURE_HI: Record<DeliveryClosureKey, string> = {
  "olo.kind.delivery_discrepancy": "डिलीवरी में अंतर",
  "olo.kind.complaint_investigation": "ग्राहक शिकायत की जाँच",
  "olo.kind.complaint_resolution": "शिकायत का समाधान तय करें",
  "olo.kind.complaint_replacement": "शिकायत का बदला माल योजना में लें",
  "olo.kind.complaint_credit_note": "शिकायत का क्रेडिट नोट",
  "olo.kind.complaint_closure": "शिकायत जाँचकर बंद करें",
  "olo.kind.payment_followup": "ग्राहक भुगतान फ़ॉलो-अप",
  "olo.kind.closure_review": "ऑर्डर कार्य-समापन समीक्षा",
  "olo.kind.final_closure": "ऑर्डर का अंतिम समापन",
  "olo.work.delivery_discrepancy": "अंतर सुलझाएँ",
  "olo.work.complaint_investigation": "शिकायत खोलें",
  "olo.work.complaint_resolution": "शिकायत खोलें",
  "olo.work.complaint_replacement": "शिकायत खोलें",
  "olo.work.complaint_credit_note": "शिकायत खोलें",
  "olo.work.complaint_closure": "शिकायत खोलें",
  "olo.work.payment_followup": "भुगतान फ़ॉलो-अप करें",
  "olo.work.closure_review": "समापन देखें",
  "olo.work.final_closure": "समापन देखें",
  "olo.lc.overall.operationally_fulfilled": "काम पूरा — समापन समीक्षा बाकी",
  "olo.lc.overall.operationally_closed_financially_settled": "काम पूरा — भुगतान पूरा",
  "olo.lc.overall.partially_closed_by_authorization": "अनुमति से आंशिक रूप से बंद",
  "olo.lc.l.replacement": "बदला माल भेजा",
  "olo.lc.s.replacement": "शिकायत का बदला माल (ऑर्डर मात्रा नहीं)",
  "olo.lc.closureRecord": "समापन रिकॉर्ड",
  "olo.lc.closureBoard": "ऑर्डर समापन"
};
