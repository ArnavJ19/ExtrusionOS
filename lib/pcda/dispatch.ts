import { buildProductionJobPcdaFields } from "./production.ts";

export type DispatchSourceAllocation = {
  line: Record<string, any>;
  weightKg: number;
  pieces: number;
};

export type VerifiedDispatchBundleInput = {
  bundle_number: string;
  source_line_id: string;
  number_of_pieces: number;
  gross_weight_kg: number;
  tare_weight_kg: number;
};

type PhysicalBundleAllocation = DispatchSourceAllocation & {
  bundleWeightKg: number;
  bundlePieces: number;
};

function sourceWeight(line: Record<string, any>) {
  return Number(
    line.available_weight_kg
    ?? line.actual_quantity_kg
    ?? line.fulfilled_weight_kg
    ?? 0
  );
}

function totalSourceWeight(line: Record<string, any>) {
  return Number(
    line.actual_quantity_kg
    ?? line.fulfilled_weight_kg
    ?? line.available_weight_kg
    ?? 0
  );
}

function sourcePieceCount(line: Record<string, any>) {
  return Number(
    line.actual_pieces
    ?? line.pieces
    ?? line.fulfilled_pieces
    ?? line.quantity_pieces
    ?? line.order_quantity
    ?? 0
  );
}

export function allocateDispatchSources(
  sourceLines: Record<string, any>[],
  requestedWeightKg: number
): DispatchSourceAllocation[] {
  if (!Number.isFinite(requestedWeightKg) || requestedWeightKg <= 0) {
    throw new Error("Dispatch weight must be greater than zero.");
  }

  let remainingWeightKg = requestedWeightKg;
  const allocations: DispatchSourceAllocation[] = [];
  for (const line of sourceLines) {
    if (remainingWeightKg <= 0.001) break;
    const availableWeightKg = sourceWeight(line);
    if (!Number.isFinite(availableWeightKg) || availableWeightKg <= 0) continue;

    const weightKg = Math.min(remainingWeightKg, availableWeightKg);
    const fullSourceWeightKg = totalSourceWeight(line);
    const sourcePieces = sourcePieceCount(line);
    const pieces = Number.isFinite(sourcePieces) && sourcePieces > 0 && Number.isFinite(fullSourceWeightKg) && fullSourceWeightKg > 0
      ? Math.min(Math.round(sourcePieces), Math.max(1, Math.round(sourcePieces * (weightKg / fullSourceWeightKg))))
      : 0;
    allocations.push({ line, weightKg, pieces });
    remainingWeightKg = Math.round((remainingWeightKg - weightKg + Number.EPSILON) * 1000) / 1000;
  }

  if (remainingWeightKg > 0.01) {
    throw new Error(
      `Only ${(requestedWeightKg - remainingWeightKg).toFixed(3)} kg is ready and unshipped; reduce dispatch weight or complete the blocked handoffs.`
    );
  }
  return allocations;
}

function splitThousandths(total: number, count: number, requirePositive: boolean) {
  const units = Math.round(total * 1000);
  if (count <= 0 || (requirePositive && units < count)) {
    throw new Error("Bundle count is too high for the dispatch weight.");
  }
  const base = Math.floor(units / count);
  const remainder = units - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 1000);
}

function splitInteger(total: number, count: number) {
  const safeTotal = Math.max(0, Math.round(total));
  const base = Math.floor(safeTotal / count);
  const remainder = safeTotal - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function allocatePhysicalBundles(
  allocations: DispatchSourceAllocation[],
  numberOfBundles: number
): PhysicalBundleAllocation[] {
  if (!Number.isInteger(numberOfBundles) || numberOfBundles <= 0) {
    throw new Error("Enter the number of physical bundles being loaded.");
  }
  if (numberOfBundles < allocations.length) {
    throw new Error(
      `At least ${allocations.length} bundles are required because material comes from ${allocations.length} separately traceable sources.`
    );
  }

  const bundleCounts = allocations.map(() => 1);
  for (let remaining = numberOfBundles - allocations.length; remaining > 0; remaining -= 1) {
    let targetIndex = 0;
    for (let index = 1; index < allocations.length; index += 1) {
      if ((allocations[index].weightKg / bundleCounts[index]) > (allocations[targetIndex].weightKg / bundleCounts[targetIndex])) {
        targetIndex = index;
      }
    }
    bundleCounts[targetIndex] += 1;
  }

  return allocations.flatMap((allocation, allocationIndex) => {
    const count = bundleCounts[allocationIndex];
    const weights = splitThousandths(allocation.weightKg, count, true);
    const pieces = splitInteger(allocation.pieces, count);
    return weights.map((bundleWeightKg, index) => ({
      ...allocation,
      bundleWeightKg,
      bundlePieces: pieces[index]
    }));
  });
}

export function buildPackingListItems(
  sourceLines: Record<string, any>[],
  dispatchId: string,
  dispatchNumber: string,
  companyId: string,
  requestedWeightKg: number,
  numberOfBundles?: number,
  bundleTareWeightsKg: number[] = []
) {
  const sourceAllocations = allocateDispatchSources(sourceLines, requestedWeightKg);
  const physicalBundles = allocatePhysicalBundles(sourceAllocations, numberOfBundles ?? sourceAllocations.length);
  const tareWeights = bundleTareWeightsKg.length
    ? bundleTareWeightsKg.map((weight) => Number(Number(weight).toFixed(3)))
    : physicalBundles.map(() => 0);
  if (tareWeights.length !== physicalBundles.length) {
    throw new Error(`Enter one tare weight for each of the ${physicalBundles.length} physical bundles.`);
  }
  if (tareWeights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
    throw new Error("Every bundle tare weight must be zero or greater.");
  }

  return physicalBundles.map(({ line, bundleWeightKg, bundlePieces }, index) => {
    const sourceKind = line.source_kind === "dealer_stock"
      ? "dealer stock fulfillment"
      : line.source_kind === "reservation"
        ? "reserved stock"
        : "production job";
    const tareWeightKg = tareWeights[index];
    return {
      ...buildProductionJobPcdaFields(line, companyId),
      company_id: companyId,
      dispatch_id: dispatchId,
      profile_id: line.profile_id,
      source_record_id: line.order_id,
      source_line_id: line.id,
      order_item_id: line.order_item_id ?? null,
      quote_item_id: line.quote_item_id ?? null,
      finishing_type: line.finishing_type ?? null,
      net_rate: line.unit_rate ?? line.net_rate ?? null,
      source_kind: line.source_kind ?? "production",
      reservation_id: line.source_kind === "reservation" ? (line.reservation_id ?? line.id) : null,
      profile_stock_batch_id: line.profile_stock_batch_id ?? null,
      bundle_number: `${dispatchNumber}-${String(index + 1).padStart(2, "0")}`,
      number_of_pieces: bundlePieces,
      gross_weight_kg: Number((bundleWeightKg + tareWeightKg).toFixed(3)),
      tare_weight_kg: tareWeightKg,
      net_weight_kg: bundleWeightKg,
      notes: `Allocated from ${sourceKind} ${line.job_number ?? line.id}`
    };
  });
}

export function buildVerifiedPackingListItems(
  sourceLines: Record<string, any>[],
  companyId: string,
  bundles: VerifiedDispatchBundleInput[]
) {
  if (!bundles.length) throw new Error("Scan or enter at least one physical bundle.");

  const sourceById = new Map(sourceLines.map((line) => [String(line.id), line]));
  const bundleNumbers = new Set<string>();
  const usedWeightBySource = new Map<string, number>();
  const usedPiecesBySource = new Map<string, number>();

  const items = bundles.map((bundle) => {
    const bundleNumber = bundle.bundle_number.trim();
    if (!bundleNumber) throw new Error("Every row needs the physical bundle identifier from its tag or scan.");
    const normalizedBundleNumber = bundleNumber.toUpperCase();
    if (bundleNumbers.has(normalizedBundleNumber)) throw new Error(`Bundle ${bundleNumber} is entered more than once.`);
    bundleNumbers.add(normalizedBundleNumber);

    const line = sourceById.get(bundle.source_line_id);
    if (!line) throw new Error(`Bundle ${bundleNumber} does not select an available source for this order.`);

    const grossWeightKg = Number(Number(bundle.gross_weight_kg).toFixed(3));
    const tareWeightKg = Number(Number(bundle.tare_weight_kg).toFixed(3));
    const numberOfPieces = Number(bundle.number_of_pieces);
    if (!Number.isFinite(grossWeightKg) || !Number.isFinite(tareWeightKg) || grossWeightKg <= tareWeightKg || tareWeightKg < 0) {
      throw new Error(`Bundle ${bundleNumber} gross weight must be greater than its non-negative tare weight.`);
    }
    if (!Number.isInteger(numberOfPieces) || numberOfPieces <= 0) {
      throw new Error(`Bundle ${bundleNumber} needs its actual positive piece count.`);
    }

    const netWeightKg = Number((grossWeightKg - tareWeightKg).toFixed(3));
    const sourceId = String(line.id);
    usedWeightBySource.set(sourceId, Number(((usedWeightBySource.get(sourceId) ?? 0) + netWeightKg).toFixed(3)));
    usedPiecesBySource.set(sourceId, (usedPiecesBySource.get(sourceId) ?? 0) + numberOfPieces);

    const sourceKind = line.source_kind === "dealer_stock"
      ? "dealer stock fulfillment"
      : line.source_kind === "reservation"
        ? "reserved stock"
        : "production job";
    return {
      ...buildProductionJobPcdaFields(line, companyId),
      company_id: companyId,
      profile_id: line.profile_id,
      source_record_id: line.order_id,
      source_line_id: line.id,
      order_item_id: line.order_item_id ?? null,
      quote_item_id: line.quote_item_id ?? null,
      finishing_type: line.finishing_type ?? null,
      net_rate: line.unit_rate ?? line.net_rate ?? null,
      source_kind: line.source_kind ?? "production",
      reservation_id: line.source_kind === "reservation" ? (line.reservation_id ?? line.id) : null,
      profile_stock_batch_id: line.profile_stock_batch_id ?? null,
      bundle_number: bundleNumber,
      number_of_pieces: numberOfPieces,
      gross_weight_kg: grossWeightKg,
      tare_weight_kg: tareWeightKg,
      net_weight_kg: netWeightKg,
      notes: `Operator verified from ${sourceKind} ${line.job_number ?? line.id}`
    };
  });

  for (const [sourceId, usedWeight] of usedWeightBySource) {
    const line = sourceById.get(sourceId)!;
    const availableWeight = sourceWeight(line);
    if (usedWeight > availableWeight + 0.01) {
      throw new Error(`Selected bundles use ${usedWeight.toFixed(3)} kg from ${line.job_number ?? sourceId}, but only ${availableWeight.toFixed(3)} kg is available.`);
    }
    const availablePieces = Number(line.available_pieces ?? sourcePieceCount(line));
    const usedPieces = usedPiecesBySource.get(sourceId) ?? 0;
    if (availablePieces > 0 && usedPieces > availablePieces) {
      throw new Error(`Selected bundles use ${usedPieces} pieces from ${line.job_number ?? sourceId}, but only ${availablePieces} are available.`);
    }
  }

  return {
    items,
    totalNetWeightKg: Number(items.reduce((sum, item) => sum + item.net_weight_kg, 0).toFixed(3)),
    totalTareWeightKg: Number(items.reduce((sum, item) => sum + item.tare_weight_kg, 0).toFixed(3)),
    totalGrossWeightKg: Number(items.reduce((sum, item) => sum + item.gross_weight_kg, 0).toFixed(3))
  };
}
