-- Alternate names confirmed by the ledger owner; keep the original customer ID.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
