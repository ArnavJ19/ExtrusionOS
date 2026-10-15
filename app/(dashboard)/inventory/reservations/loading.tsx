import { LoadingState } from "@/components/ui/loading";

export default function ReservationLedgerLoading() {
  return <LoadingState title="Loading stock reservations" description="Checking reservation quantities, lifecycle evidence and matching records." />;
}
