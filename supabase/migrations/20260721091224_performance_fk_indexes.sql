-- Add covering B-tree indexes for every public foreign key that does not
-- already have an index whose leading columns match the FK columns.
do $$
declare
  v_fk record;
  v_columns text;
  v_index_name text;
begin
  for v_fk in
    select
      constraint_row.conname,
      constraint_row.conrelid,
      constraint_row.conkey,
      schema_row.nspname as schema_name,
      table_row.relname as table_name
    from pg_constraint constraint_row
    join pg_class table_row on table_row.oid = constraint_row.conrelid
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where constraint_row.contype = 'f'
      and schema_row.nspname = 'public'
      and not exists (
        select 1
        from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and index_row.indisready
          and (index_row.indkey::smallint[])[0:cardinality(constraint_row.conkey) - 1]
            = constraint_row.conkey
      )
    order by schema_row.nspname, table_row.relname, constraint_row.conname
  loop
    select string_agg(format('%I', attribute_row.attname), ', ' order by key_row.ordinality)
    into v_columns
    from unnest(v_fk.conkey) with ordinality as key_row(attribute_number, ordinality)
    join pg_attribute attribute_row
      on attribute_row.attrelid = v_fk.conrelid
     and attribute_row.attnum = key_row.attribute_number;

    v_index_name := left(
      format('idx_%s_%s', v_fk.table_name, v_fk.conname),
      54
    ) || '_' || substr(md5(v_fk.schema_name || '.' || v_fk.conname), 1, 8);

    execute format(
      'create index if not exists %I on %I.%I (%s)',
      v_index_name,
      v_fk.schema_name,
      v_fk.table_name,
      v_columns
    );
  end loop;
end $$;
