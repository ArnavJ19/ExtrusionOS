"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { ProfilePreview, type ProfilePreviewData } from "@/components/ui/profile-preview";

export function ProfileSelector({
  value,
  profiles,
  companyId,
  onChange,
  onSearchChange,
  searching,
}: {
  value: string;
  profiles: ProfilePreviewData[];
  companyId: string;
  onChange: (profileId: string) => void;
  onSearchChange: (query: string) => void;
  searching: boolean;
}) {
  const selected = profiles.find((profile) => profile.id === value) ?? null;
  return (
    <>
      <SearchableSelect
        ariaLabel="Search aluminium profile by code or name"
        value={value}
        placeholder="Search profile code or name"
        options={profiles.map((profile) => ({
          value: profile.id,
          label: `${profile.profile_code} · ${profile.profile_name}${profile.section_number ? ` · ${profile.section_number}` : ""}${profile.section_weight_kg_per_m ? ` · ${profile.section_weight_kg_per_m} kg/m` : ""}${profile.nominal_wall_thickness_mm ? ` · ${profile.nominal_wall_thickness_mm} mm wall` : ""}`,
        }))}
        onChange={onChange}
        onSearchChange={onSearchChange}
        searching={searching}
        emptyText="No matching profile. Refine the search or keep typing to find a company profile."
      />
      <ProfilePreview key={JSON.stringify([companyId, selected?.id, selected?.drawing_revision, selected?.drawing_approval_status, selected?.cross_section_image_url])} profile={selected} companyId={companyId} />
    </>
  );
}
