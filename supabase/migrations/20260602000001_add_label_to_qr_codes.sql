-- Migration: Add label column to qr_codes
-- Adds the missing 'label' column which the frontend uses to display human-readable QR code labels.

ALTER TABLE public.qr_codes 
ADD COLUMN IF NOT EXISTS label TEXT;
