# Supabase Storage and File Guidelines — ExtrusionOS

## 1. Purpose

ExtrusionOS stores business documents such as:

- Company logos
- Authorized signatures
- Profile drawings
- Die drawings
- Quote PDFs
- Order PDFs
- Dispatch proofs
- Packing lists
- Quality certificates
- Purchase documents
- Invoice PDFs
- Customer portal documents

Files must be secure, company-scoped, and easy to retrieve.

## 2. Bucket Strategy

Recommended buckets:

- `company-assets`
- `profile-drawings`
- `die-drawings`
- `quote-pdfs`
- `order-documents`
- `dispatch-documents`
- `quality-documents`
- `invoice-pdfs`
- `purchase-documents`
- `general-documents`

Sensitive buckets should be private.

## 3. File Path Rule

Every file path should include `company_id`.

Recommended format:

```text
company_id/entity_type/entity_id/file_name
```

Examples:

```text
<company_id>/quotes/<quote_id>/quotation-Q-2026-001.pdf
<company_id>/dies/<die_id>/die-drawing-D-1001.pdf
<company_id>/dispatches/<dispatch_id>/proof-of-delivery.jpg
<company_id>/quality/<test_id>/test-certificate.pdf
```

## 4. Security Rules

Users must not:

- Upload into another company’s folder
- Read another company’s files
- Delete another company’s files
- Access private files without permission

Storage policies must enforce company-based access.

Do not rely only on obscured URLs.

## 5. Public vs Private Files

Public files may include:

- Non-sensitive company logo
- Public brochure assets if explicitly intended

Private files include:

- Quotes
- Internal costing PDFs
- Die drawings
- Customer documents
- Dispatch proof
- Quality certificates
- Invoice PDFs
- Purchase documents

Use signed URLs for private files where needed.

## 6. Upload Validation

Validate:

- File type
- File size
- File extension
- Entity ownership
- User permission

Recommended accepted types:

- PDF
- PNG
- JPG/JPEG
- WEBP
- CSV where needed
- XLSX only if supported and validated

Block dangerous files where not needed:

- executable files
- scripts
- HTML uploads
- unknown binary uploads

## 7. Filename Handling

Prevent collisions by using:

- entity ID
- timestamp
- random suffix
- sanitized original filename

Do not trust original filename blindly.

Avoid path traversal.

Bad:

```text
../../secret.env
```

Good:

```text
quote-Q-2026-001-20260518.pdf
```

## 8. File Metadata

Store file metadata in `documents` table where useful:

- company_id
- related_entity_type
- related_entity_id
- document_type
- file_name
- file_url or storage_path
- mime_type
- size_bytes
- uploaded_by
- created_at

Prefer storing storage path over permanent public URL for private files.

## 9. File Replacement

When replacing files:

- Decide whether to keep old version
- Store document version if needed
- Avoid orphaned files
- Do not delete important history without permission

## 10. PDF Storage

Generated PDFs should be stored with clear paths.

Examples:

```text
<company_id>/quotes/<quote_id>/quotation-rev-1.pdf
<company_id>/orders/<order_id>/order-confirmation.pdf
<company_id>/dispatches/<dispatch_id>/packing-list.pdf
```

## 11. Customer Sharing

Customer/shared links should use controlled access.

Do not expose private bucket URLs directly unless intended.

Preferred:

- Generate signed URL
- Or serve through safe public share route
- Or provide sanitized PDF copy only

## 12. Storage Audit Checklist

- [ ] Bucket exists
- [ ] Bucket privacy is correct
- [ ] Storage policy exists
- [ ] Path includes company_id
- [ ] Upload validates file type
- [ ] Upload validates file size
- [ ] User permission checked
- [ ] File metadata saved
- [ ] Cross-company access blocked
- [ ] Signed URLs used for private files
- [ ] Customer-facing documents sanitized
