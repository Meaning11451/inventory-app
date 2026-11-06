-- A single read snapshot for all inventory data. Uses the caller's permissions.
CREATE OR REPLACE FUNCTION public.export_inventory_backup()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $backup$
  WITH snapshot AS (
    SELECT jsonb_build_object(
      'products', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id), '[]'::jsonb) FROM public.products p),
      'customers', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb) FROM public.customers c),
      'inbound_records', (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb) FROM public.inbound_records i),
      'outbound_records', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id), '[]'::jsonb) FROM public.outbound_records o),
      'current_stock', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id), '[]'::jsonb) FROM public.current_stock s)
    ) AS tables
  )
  SELECT jsonb_build_object(
    'format', 'inventory-app-backup',
    'version', 1,
    'kind', 'application-data',
    'exported_at', statement_timestamp(),
    'tables', tables,
    'counts', (SELECT jsonb_object_agg(key, jsonb_array_length(value)) FROM jsonb_each(tables))
  ) FROM snapshot;
$backup$;

REVOKE ALL ON FUNCTION public.export_inventory_backup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.export_inventory_backup() TO anon, authenticated, service_role;

-- Keep inventory views subject to the same policies as their underlying tables.
ALTER VIEW public.current_stock SET (security_invoker = true);
