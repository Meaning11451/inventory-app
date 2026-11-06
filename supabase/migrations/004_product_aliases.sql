-- Product nicknames are explicit and shared across devices.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}';
