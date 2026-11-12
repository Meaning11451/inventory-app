-- Keep uncertain duplicate cards available for history, outside new batch entries.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS entry_match_pending boolean NOT NULL DEFAULT false;
