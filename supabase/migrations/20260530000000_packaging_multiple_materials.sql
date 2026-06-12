-- Update packaging_materials material_type constraint
ALTER TABLE public.packaging_materials DROP CONSTRAINT IF EXISTS packaging_materials_material_type_check;
ALTER TABLE public.packaging_materials ADD CONSTRAINT packaging_materials_material_type_check CHECK (material_type IN ('stretch_film','bubble_wrap','paper','hdpe','pp_woven_sheet','wooden_crate','strapping','corner_protector','other'));

-- Drop consumption_per_profile_meter
ALTER TABLE public.packaging_materials DROP COLUMN IF EXISTS consumption_per_profile_meter;

-- Create packaging_job_materials table
CREATE TABLE IF NOT EXISTS public.packaging_job_materials (
    id uuid primary key default gen_random_uuid(),
    company_id uuid not null references public.companies(id) on delete cascade,
    job_id uuid not null references public.packaging_jobs(id) on delete cascade,
    material_id uuid not null references public.packaging_materials(id) on delete restrict,
    quantity_required numeric(14,3) not null default 0 check (quantity_required >= 0),
    created_by uuid references auth.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Enable RLS
ALTER TABLE public.packaging_job_materials ENABLE ROW LEVEL SECURITY;

-- Policies for packaging_job_materials
DROP POLICY IF EXISTS "packaging job materials tenant read" ON public.packaging_job_materials;
DROP POLICY IF EXISTS "packaging job materials tenant insert" ON public.packaging_job_materials;
DROP POLICY IF EXISTS "packaging job materials tenant update" ON public.packaging_job_materials;
DROP POLICY IF EXISTS "packaging job materials tenant delete" ON public.packaging_job_materials;

CREATE POLICY "packaging job materials tenant read" ON public.packaging_job_materials FOR SELECT USING (company_id = public.get_current_user_company_id());
CREATE POLICY "packaging job materials tenant insert" ON public.packaging_job_materials FOR INSERT WITH CHECK (company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('owner','admin','production_manager','production','dispatch_manager','dispatch'));
CREATE POLICY "packaging job materials tenant update" ON public.packaging_job_materials FOR UPDATE USING (company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('owner','admin','production_manager','production','dispatch_manager','dispatch')) WITH CHECK (company_id = public.get_current_user_company_id());
CREATE POLICY "packaging job materials tenant delete" ON public.packaging_job_materials FOR DELETE USING (company_id = public.get_current_user_company_id() AND public.get_current_user_role() IN ('owner','admin','production_manager','production','dispatch_manager','dispatch'));

-- Migrate existing data (only if column hasn't been dropped yet)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'packaging_jobs' AND column_name = 'material_id') THEN
        EXECUTE 'INSERT INTO public.packaging_job_materials (company_id, job_id, material_id, quantity_required, created_by, created_at, updated_at)
        SELECT company_id, id, material_id, material_quantity_required, created_by, created_at, updated_at
        FROM public.packaging_jobs
        WHERE material_id IS NOT NULL';
    END IF;
END
$$;

-- Drop trigger first
DROP TRIGGER IF EXISTS apply_packaging_material_stock ON public.packaging_jobs;

-- Drop columns from packaging_jobs
ALTER TABLE public.packaging_jobs DROP COLUMN IF EXISTS material_id;
ALTER TABLE public.packaging_jobs DROP COLUMN IF EXISTS material_quantity_required;

-- Rewrite the function to handle material insertions/updates directly
CREATE OR REPLACE FUNCTION public.apply_packaging_material_stock_from_materials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_status text;
  v_delta numeric := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_job_status FROM public.packaging_jobs WHERE id = NEW.job_id;
    IF v_job_status <> 'cancelled' AND NEW.quantity_required > 0 THEN
      v_delta := NEW.quantity_required;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_job_status FROM public.packaging_jobs WHERE id = NEW.job_id;
    
    -- Restore old
    IF v_job_status <> 'cancelled' AND OLD.quantity_required > 0 THEN
      UPDATE public.packaging_materials
      SET current_stock = current_stock + OLD.quantity_required,
          updated_at = now()
      WHERE id = OLD.material_id AND company_id = OLD.company_id;

      INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
      VALUES (OLD.company_id, OLD.job_id, OLD.material_id, 'restore', OLD.quantity_required, auth.uid());
    END IF;

    -- Apply new
    IF v_job_status <> 'cancelled' AND NEW.quantity_required > 0 THEN
      v_delta := NEW.quantity_required;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT status INTO v_job_status FROM public.packaging_jobs WHERE id = OLD.job_id;
    -- Restore old
    IF v_job_status <> 'cancelled' AND OLD.quantity_required > 0 THEN
      UPDATE public.packaging_materials
      SET current_stock = current_stock + OLD.quantity_required,
          updated_at = now()
      WHERE id = OLD.material_id AND company_id = OLD.company_id;

      INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
      VALUES (OLD.company_id, OLD.job_id, OLD.material_id, 'restore', OLD.quantity_required, auth.uid());
    END IF;
    RETURN OLD;
  END IF;

  IF v_delta > 0 THEN
    UPDATE public.packaging_materials
    SET current_stock = current_stock - v_delta,
        updated_at = now()
    WHERE id = NEW.material_id
      AND company_id = NEW.company_id
      AND current_stock >= v_delta;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Not enough packaging material stock' USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
    VALUES (NEW.company_id, NEW.job_id, NEW.material_id, 'issue', v_delta, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger for material changes
CREATE TRIGGER apply_packaging_material_stock_from_materials
AFTER INSERT OR UPDATE OF material_id, quantity_required OR DELETE
ON public.packaging_job_materials
FOR EACH ROW EXECUTE FUNCTION public.apply_packaging_material_stock_from_materials();


-- Trigger for job cancellation
CREATE OR REPLACE FUNCTION public.handle_packaging_job_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
      -- Job is cancelled, restore all materials
      FOR m IN SELECT * FROM public.packaging_job_materials WHERE job_id = NEW.id LOOP
        UPDATE public.packaging_materials
        SET current_stock = current_stock + m.quantity_required,
            updated_at = now()
        WHERE id = m.material_id AND company_id = m.company_id;

        INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
        VALUES (m.company_id, NEW.id, m.material_id, 'restore', m.quantity_required, auth.uid());
      END LOOP;
    ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
      -- Job is un-cancelled (rare, but handle it by issuing materials)
      FOR m IN SELECT * FROM public.packaging_job_materials WHERE job_id = NEW.id LOOP
        UPDATE public.packaging_materials
        SET current_stock = current_stock - m.quantity_required,
            updated_at = now()
        WHERE id = m.material_id AND company_id = m.company_id AND current_stock >= m.quantity_required;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Not enough packaging material stock to restore job' USING ERRCODE = '23514';
        END IF;

        INSERT INTO public.packaging_material_movements(company_id, packaging_job_id, material_id, movement_type, quantity, created_by)
        VALUES (m.company_id, NEW.id, m.material_id, 'issue', m.quantity_required, auth.uid());
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER handle_packaging_job_status_change
AFTER UPDATE OF status
ON public.packaging_jobs
FOR EACH ROW EXECUTE FUNCTION public.handle_packaging_job_status_change();
