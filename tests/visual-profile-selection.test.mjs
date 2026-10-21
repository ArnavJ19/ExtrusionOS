import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getApprovedProfileImagePath, isApprovedProfileImageType } from "../lib/profiles/selection.ts";

const preview = readFileSync("components/ui/profile-preview.tsx", "utf8");
const selector = readFileSync("components/ui/profile-selector.tsx", "utf8");
const quotes = readFileSync("components/modules/quotes-client.tsx", "utf8");

test("only approved tenant-owned storage paths can load as profile artwork", () => {
  assert.equal(getApprovedProfileImagePath("company-a/profiles/a.png", "approved", "company-a"), "company-a/profiles/a.png");
  assert.equal(getApprovedProfileImagePath("company-b/profiles/a.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a/profiles/a.png", "pending", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("https://other.example/a.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a/../private/a.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a/%2e%2e/private.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a%2fprivate/a.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("/company-a/profiles/a.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a/profiles/a.png?token=elsewhere", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a\\private.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("company-a/profiles/\u0000.png", "approved", "company-a"), null);
  assert.equal(getApprovedProfileImagePath("", "approved", "company-a"), null);
});

test("non-image, unsupported, and unavailable artwork has a clear failure state", () => {
  assert.equal(isApprovedProfileImageType("image/png"), true);
  assert.equal(isApprovedProfileImageType("image/jpeg; charset=binary"), true);
  assert.equal(isApprovedProfileImageType("application/pdf"), false);
  assert.equal(isApprovedProfileImageType("image/svg+xml"), false);
  assert.match(preview, /Approved cross-section artwork unavailable/);
  assert.match(preview, /storage\.from\("documents"\)\.download\(path\)/);
  assert.match(preview, /if \(cancelled\) return;\s*objectUrl = URL\.createObjectURL\(data\)/);
  assert.match(preview, /if \(objectUrl\) URL\.revokeObjectURL\(objectUrl\)/);
});

test("quote profile selection shows revision-aware identity metadata in the live editor", () => {
  assert.match(selector, /ariaLabel="Search aluminium profile by code or name"/);
  assert.match(selector, /<ProfilePreview key=\{JSON\.stringify\(\[companyId, selected\?\.id, selected\?\.drawing_revision, selected\?\.drawing_approval_status, selected\?\.cross_section_image_url\]\)\} profile=\{selected\}/);
  assert.match(preview, /drawing_revision/);
  assert.match(preview, /section_weight_kg_per_m/);
  assert.match(preview, /circumscribing_circle_diameter_mm/);
  assert.match(preview, /role="dialog" aria-modal="true"/);
  assert.match(quotes, /<ProfileSelector value=\{item\.profile_id\}/);
  assert.match(quotes, /cross_section_image_url, circumscribing_circle_diameter_mm/);
});
