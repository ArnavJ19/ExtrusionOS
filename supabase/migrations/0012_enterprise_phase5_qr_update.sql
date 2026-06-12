-- Migration: Update QR Codes to have a strict 60 days expiry

ALTER TABLE public.qr_codes 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT now() + interval '60 days';

-- Add a status constraint if it doesn't exist, and an index for querying active/expired QRs
CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON public.qr_codes(expires_at);

-- Optional: Create a view or function to automatically consider them expired 
-- (Though application logic checking `expires_at > now()` is usually sufficient)
