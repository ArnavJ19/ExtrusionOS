"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateDieTechnicalSheet, generateProfileTechnicalSheet } from "@/lib/actions/pcda-reports";

type Props = {
  entityType: "die" | "profile";
  entityId: string;
  label?: string;
};

export function GenerateReportButton({ entityType, entityId, label }: Props) {
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const result = entityType === "die"
        ? await generateDieTechnicalSheet(entityId)
        : await generateProfileTechnicalSheet(entityId);

      if (!result.success) {
        toast.error(result.error ?? "Report generation failed");
        return;
      }
      toast.success("Technical sheet generated and stored. Check Documents tab.");
    } catch {
      toast.error("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Button type="button" variant="secondary" disabled={generating} onClick={handleGenerate}>
      <FileText className="mr-1.5 h-4 w-4" />
      {generating ? "Generating..." : label ?? "Generate Technical Sheet"}
    </Button>
  );
}
