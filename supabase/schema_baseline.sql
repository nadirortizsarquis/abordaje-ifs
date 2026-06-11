--
-- PostgreSQL database dump
--

\restrict Lg1IWgYfZP19f0cdZruU7fqjh4GO68kzxEIQMAkfU3laoq2hpyl8qR74J2xFgYo

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: comisiones; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA comisiones;


--
-- Name: patrimoniales; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA patrimoniales;


--
-- Name: private; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA private;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'agent')
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;


--
-- Name: is_assistant_of(uuid); Type: FUNCTION; Schema: private; Owner: -
--

CREATE FUNCTION private.is_assistant_of(target_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'private'
    AS $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid()
      and assistant_of_id = target_id
  );
$$;


--
-- Name: get_next_career_scale(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_career_scale(p_current_code integer, p_year integer) RETURNS TABLE(required_billing_usd numeric, required_persistency_pct numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'comisiones', 'public'
    AS $$
begin
  -- Hard cap visible para el agente: no exponer nada arriba de código 60.
  if p_current_code >= 60 then return; end if;
  if p_current_code + 5 > 60 then return; end if;
  return query
    select cs.required_billing_usd, cs.required_persistency_pct
    from comisiones.career_scales cs
    where cs.year = p_year and cs.code = p_current_code + 5;
end;
$$;


--
-- Name: seed_abordaje_columnas_default(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_abordaje_columnas_default() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.abordaje_tareas_columnas (agente_id, titulo, orden, slug) values
    (new.id, 'Administrativo',    0, null),
    (new.id, 'Ventas pendientes', 1, null),
    (new.id, 'Abordar',           2, 'abordar'),
    (new.id, 'Personal',          3, null);
  return new;
end;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: career_scales; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.career_scales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year integer NOT NULL,
    code integer NOT NULL,
    required_billing_usd numeric DEFAULT 0 NOT NULL,
    required_persistency_pct numeric DEFAULT 85 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: custom_report_rows; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.custom_report_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    poliza text NOT NULL,
    asesor text NOT NULL,
    prima_anual numeric,
    fecha_efectivo date,
    status text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    filename text,
    CONSTRAINT custom_report_rows_status_check CHECK ((status = ANY (ARRAY['activo'::text, 'gracia'::text, 'caido'::text])))
);


--
-- Name: liquidation_rows; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.liquidation_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    asesor text NOT NULL,
    poliza text NOT NULL,
    propietario text,
    frecuencia text,
    tipo_negocio text,
    producto text,
    asesor_sup text,
    id_asesor text,
    periodo_n integer,
    periodo_m integer,
    fecha_efectiva date,
    fecha_pago date,
    comision numeric,
    comision_cobertura numeric,
    comision_ingresos numeric,
    comision_ec numeric,
    comision_cancer numeric,
    pct_cobertura numeric,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    filename text
);


--
-- Name: policy_status_overrides; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.policy_status_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    poliza text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT policy_status_overrides_status_check CHECK ((status = ANY (ARRAY['activo'::text, 'gracia'::text, 'caido'::text])))
);


--
-- Name: simulator_config; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.simulator_config (
    user_id uuid NOT NULL,
    ole_base_pct numeric DEFAULT 40,
    ole_base_years integer DEFAULT 1,
    ole_adic_pct numeric DEFAULT 15,
    ole_adic_years integer DEFAULT 10,
    ole_renov_pct numeric DEFAULT 0,
    ole_renov_years integer DEFAULT 0,
    ole_has_team boolean DEFAULT false,
    ole_resid_pct numeric DEFAULT 0,
    ole_resid_years integer DEFAULT 0,
    bd_first_pct numeric DEFAULT 12.5,
    bd_renov_pct numeric DEFAULT 7.5,
    pat_pct numeric DEFAULT 7,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    it_renov_year2 numeric DEFAULT 3,
    it_renov_year3 numeric DEFAULT 3,
    it_renov_year4 numeric DEFAULT 1,
    it_renov_year5 numeric DEFAULT 1,
    it_base_10yr_pct numeric DEFAULT 15,
    it_base_15yr_pct numeric DEFAULT 25,
    it_base_20yr_pct numeric DEFAULT 30,
    ole_persistency numeric DEFAULT 90,
    it_persistency numeric DEFAULT 90,
    bd_persistency numeric DEFAULT 95,
    pat_persistency numeric DEFAULT 85
);


--
-- Name: simulator_saved_scenarios; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.simulator_saved_scenarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    scenario jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: simulator_scenario; Type: TABLE; Schema: comisiones; Owner: -
--

CREATE TABLE comisiones.simulator_scenario (
    user_id uuid NOT NULL,
    scenario jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: abordaje_agendados; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_agendados (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospecto_id uuid,
    agente_id uuid NOT NULL,
    fecha timestamp with time zone NOT NULL,
    nota text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid
);


--
-- Name: abordaje_event_colors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_event_colors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agente_id uuid NOT NULL,
    event_key text NOT NULL,
    color text NOT NULL,
    actor_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: abordaje_maintenance_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_maintenance_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agente_id uuid NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    monto numeric(12,2),
    fecha_pago date,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT abordaje_maintenance_payments_month_check CHECK (((month >= 1) AND (month <= 12))),
    CONSTRAINT abordaje_maintenance_payments_year_check CHECK (((year >= 2020) AND (year <= 2100)))
);


--
-- Name: TABLE abordaje_maintenance_payments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.abordaje_maintenance_payments IS 'Registro de pagos de mantenimiento del sistema (monto + fecha) por agente y mes. Acceso solo a profiles.role=admin via RLS.';


--
-- Name: abordaje_prospecto_contactos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_prospecto_contactos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospecto_id uuid NOT NULL,
    agente_id uuid NOT NULL,
    tipo text DEFAULT ''::text,
    fecha date,
    hora time without time zone,
    observacion text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    google_event_id text,
    actor_id uuid
);


--
-- Name: abordaje_prospectos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_prospectos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agente_id uuid NOT NULL,
    nombre text DEFAULT ''::text NOT NULL,
    telefono text DEFAULT ''::text,
    preferencia_contacto text DEFAULT ''::text,
    detalle text DEFAULT ''::text,
    referente text DEFAULT ''::text,
    observaciones text DEFAULT ''::text,
    estado text DEFAULT 'nuevo'::text NOT NULL,
    proximo_contacto date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_id uuid,
    archivado boolean DEFAULT false NOT NULL,
    CONSTRAINT abordaje_prospectos_estado_check CHECK ((estado = ANY (ARRAY['nuevo'::text, 'pendiente'::text, 'programado'::text, 'largo-plazo'::text, 'agendado'::text, 'rechazado'::text])))
);


--
-- Name: COLUMN abordaje_prospectos.archivado; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.abordaje_prospectos.archivado IS 'Prospects archivados se ocultan de la vista Lista de Abordaje pero conservan sus tareas, recordatorios y eventos de calendario.';


--
-- Name: abordaje_tareas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_tareas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    columna_id uuid NOT NULL,
    agente_id uuid NOT NULL,
    titulo text DEFAULT ''::text,
    fecha_recordatorio date,
    hora_recordatorio time without time zone,
    observacion text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    prospecto_id uuid,
    google_event_id text,
    actor_id uuid,
    archivada boolean DEFAULT false NOT NULL,
    compania text
);


--
-- Name: COLUMN abordaje_tareas.compania; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.abordaje_tareas.compania IS 'Id de compañía asignada (ole / investors-trust / life-group / best-doctors / patrimonial). Mostrada como logo en la tarjeta del Kanban.';


--
-- Name: abordaje_tareas_columnas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.abordaje_tareas_columnas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agente_id uuid NOT NULL,
    titulo text DEFAULT 'Nueva columna'::text NOT NULL,
    orden integer DEFAULT 999 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text,
    actor_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    display_name text,
    role text DEFAULT 'agent'::text NOT NULL,
    advisor_name_ole text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    abordaje_settings jsonb,
    gcal_enabled boolean DEFAULT false NOT NULL,
    assistant_of_id uuid,
    shares_calendar_with_assistant boolean DEFAULT false NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'agent'::text])))
);


--
-- Name: user_google_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_google_tokens (
    user_id uuid NOT NULL,
    refresh_token text NOT NULL,
    scope text,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: career_scales career_scales_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.career_scales
    ADD CONSTRAINT career_scales_pkey PRIMARY KEY (id);


--
-- Name: career_scales career_scales_year_code_key; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.career_scales
    ADD CONSTRAINT career_scales_year_code_key UNIQUE (year, code);


--
-- Name: custom_report_rows custom_report_rows_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.custom_report_rows
    ADD CONSTRAINT custom_report_rows_pkey PRIMARY KEY (id);


--
-- Name: liquidation_rows liquidation_rows_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.liquidation_rows
    ADD CONSTRAINT liquidation_rows_pkey PRIMARY KEY (id);


--
-- Name: policy_status_overrides policy_status_overrides_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.policy_status_overrides
    ADD CONSTRAINT policy_status_overrides_pkey PRIMARY KEY (id);


--
-- Name: policy_status_overrides policy_status_overrides_user_id_poliza_key; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.policy_status_overrides
    ADD CONSTRAINT policy_status_overrides_user_id_poliza_key UNIQUE (user_id, poliza);


--
-- Name: simulator_config simulator_config_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.simulator_config
    ADD CONSTRAINT simulator_config_pkey PRIMARY KEY (user_id);


--
-- Name: simulator_saved_scenarios simulator_saved_scenarios_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.simulator_saved_scenarios
    ADD CONSTRAINT simulator_saved_scenarios_pkey PRIMARY KEY (id);


--
-- Name: simulator_scenario simulator_scenario_pkey; Type: CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.simulator_scenario
    ADD CONSTRAINT simulator_scenario_pkey PRIMARY KEY (user_id);


--
-- Name: abordaje_agendados abordaje_agendados_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_agendados
    ADD CONSTRAINT abordaje_agendados_pkey PRIMARY KEY (id);


--
-- Name: abordaje_event_colors abordaje_event_colors_agente_id_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_event_colors
    ADD CONSTRAINT abordaje_event_colors_agente_id_event_key_key UNIQUE (agente_id, event_key);


--
-- Name: abordaje_event_colors abordaje_event_colors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_event_colors
    ADD CONSTRAINT abordaje_event_colors_pkey PRIMARY KEY (id);


--
-- Name: abordaje_maintenance_payments abordaje_maintenance_payments_agente_id_year_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_maintenance_payments
    ADD CONSTRAINT abordaje_maintenance_payments_agente_id_year_month_key UNIQUE (agente_id, year, month);


--
-- Name: abordaje_maintenance_payments abordaje_maintenance_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_maintenance_payments
    ADD CONSTRAINT abordaje_maintenance_payments_pkey PRIMARY KEY (id);


--
-- Name: abordaje_prospecto_contactos abordaje_prospecto_contactos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospecto_contactos
    ADD CONSTRAINT abordaje_prospecto_contactos_pkey PRIMARY KEY (id);


--
-- Name: abordaje_prospectos abordaje_prospectos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospectos
    ADD CONSTRAINT abordaje_prospectos_pkey PRIMARY KEY (id);


--
-- Name: abordaje_tareas_columnas abordaje_tareas_columnas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas_columnas
    ADD CONSTRAINT abordaje_tareas_columnas_pkey PRIMARY KEY (id);


--
-- Name: abordaje_tareas abordaje_tareas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas
    ADD CONSTRAINT abordaje_tareas_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: user_google_tokens user_google_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_tokens
    ADD CONSTRAINT user_google_tokens_pkey PRIMARY KEY (user_id);


--
-- Name: career_scales_year_idx; Type: INDEX; Schema: comisiones; Owner: -
--

CREATE INDEX career_scales_year_idx ON comisiones.career_scales USING btree (year);


--
-- Name: idx_custom_rows_poliza; Type: INDEX; Schema: comisiones; Owner: -
--

CREATE INDEX idx_custom_rows_poliza ON comisiones.custom_report_rows USING btree (user_id, poliza);


--
-- Name: idx_custom_rows_user; Type: INDEX; Schema: comisiones; Owner: -
--

CREATE INDEX idx_custom_rows_user ON comisiones.custom_report_rows USING btree (user_id);


--
-- Name: idx_liq_rows_poliza; Type: INDEX; Schema: comisiones; Owner: -
--

CREATE INDEX idx_liq_rows_poliza ON comisiones.liquidation_rows USING btree (user_id, poliza);


--
-- Name: idx_liq_rows_user; Type: INDEX; Schema: comisiones; Owner: -
--

CREATE INDEX idx_liq_rows_user ON comisiones.liquidation_rows USING btree (user_id);


--
-- Name: simulator_saved_scenarios_user_idx; Type: INDEX; Schema: comisiones; Owner: -
--

CREATE INDEX simulator_saved_scenarios_user_idx ON comisiones.simulator_saved_scenarios USING btree (user_id, created_at DESC);


--
-- Name: abordaje_agendados_agente_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_agendados_agente_id_idx ON public.abordaje_agendados USING btree (agente_id);


--
-- Name: abordaje_agendados_fecha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_agendados_fecha_idx ON public.abordaje_agendados USING btree (fecha);


--
-- Name: abordaje_columnas_agente_slug_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX abordaje_columnas_agente_slug_uq ON public.abordaje_tareas_columnas USING btree (agente_id, slug) WHERE (slug IS NOT NULL);


--
-- Name: abordaje_event_colors_agente_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_event_colors_agente_idx ON public.abordaje_event_colors USING btree (agente_id);


--
-- Name: abordaje_maintenance_payments_agente_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_maintenance_payments_agente_idx ON public.abordaje_maintenance_payments USING btree (agente_id);


--
-- Name: abordaje_maintenance_payments_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_maintenance_payments_year_idx ON public.abordaje_maintenance_payments USING btree (year);


--
-- Name: abordaje_prospecto_contactos_agente_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_prospecto_contactos_agente_id_idx ON public.abordaje_prospecto_contactos USING btree (agente_id);


--
-- Name: abordaje_prospecto_contactos_prospecto_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_prospecto_contactos_prospecto_id_idx ON public.abordaje_prospecto_contactos USING btree (prospecto_id);


--
-- Name: abordaje_prospectos_agente_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_prospectos_agente_id_idx ON public.abordaje_prospectos USING btree (agente_id);


--
-- Name: abordaje_prospectos_archivado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_prospectos_archivado_idx ON public.abordaje_prospectos USING btree (archivado) WHERE (archivado = true);


--
-- Name: abordaje_prospectos_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_prospectos_estado_idx ON public.abordaje_prospectos USING btree (estado);


--
-- Name: abordaje_tareas_agente_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_tareas_agente_id_idx ON public.abordaje_tareas USING btree (agente_id);


--
-- Name: abordaje_tareas_columna_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_tareas_columna_id_idx ON public.abordaje_tareas USING btree (columna_id);


--
-- Name: abordaje_tareas_columnas_agente_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_tareas_columnas_agente_id_idx ON public.abordaje_tareas_columnas USING btree (agente_id);


--
-- Name: abordaje_tareas_prospecto_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX abordaje_tareas_prospecto_idx ON public.abordaje_tareas USING btree (prospecto_id);


--
-- Name: idx_abordaje_tareas_agente_no_archivada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_abordaje_tareas_agente_no_archivada ON public.abordaje_tareas USING btree (agente_id, created_at) WHERE (archivada = false);


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);


--
-- Name: profiles_assistant_of_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profiles_assistant_of_id_idx ON public.profiles USING btree (assistant_of_id) WHERE (assistant_of_id IS NOT NULL);


--
-- Name: career_scales career_scales_set_updated_at; Type: TRIGGER; Schema: comisiones; Owner: -
--

CREATE TRIGGER career_scales_set_updated_at BEFORE UPDATE ON comisiones.career_scales FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: policy_status_overrides policy_status_set_updated_at; Type: TRIGGER; Schema: comisiones; Owner: -
--

CREATE TRIGGER policy_status_set_updated_at BEFORE UPDATE ON comisiones.policy_status_overrides FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: simulator_config simulator_config_set_updated_at; Type: TRIGGER; Schema: comisiones; Owner: -
--

CREATE TRIGGER simulator_config_set_updated_at BEFORE UPDATE ON comisiones.simulator_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: simulator_scenario simulator_scenario_set_updated_at; Type: TRIGGER; Schema: comisiones; Owner: -
--

CREATE TRIGGER simulator_scenario_set_updated_at BEFORE UPDATE ON comisiones.simulator_scenario FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles on_new_profile_seed_abordaje; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER on_new_profile_seed_abordaje AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.seed_abordaje_columnas_default();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: abordaje_prospectos trg_prospectos_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prospectos_updated BEFORE UPDATE ON public.abordaje_prospectos FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: abordaje_tareas trg_tareas_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tareas_updated BEFORE UPDATE ON public.abordaje_tareas FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: custom_report_rows custom_report_rows_user_id_fkey; Type: FK CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.custom_report_rows
    ADD CONSTRAINT custom_report_rows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: liquidation_rows liquidation_rows_user_id_fkey; Type: FK CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.liquidation_rows
    ADD CONSTRAINT liquidation_rows_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: policy_status_overrides policy_status_overrides_user_id_fkey; Type: FK CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.policy_status_overrides
    ADD CONSTRAINT policy_status_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: simulator_config simulator_config_user_id_fkey; Type: FK CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.simulator_config
    ADD CONSTRAINT simulator_config_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: simulator_saved_scenarios simulator_saved_scenarios_user_id_fkey; Type: FK CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.simulator_saved_scenarios
    ADD CONSTRAINT simulator_saved_scenarios_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: simulator_scenario simulator_scenario_user_id_fkey; Type: FK CONSTRAINT; Schema: comisiones; Owner: -
--

ALTER TABLE ONLY comisiones.simulator_scenario
    ADD CONSTRAINT simulator_scenario_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abordaje_agendados abordaje_agendados_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_agendados
    ADD CONSTRAINT abordaje_agendados_actor_fk FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_agendados abordaje_agendados_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_agendados
    ADD CONSTRAINT abordaje_agendados_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_agendados abordaje_agendados_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_agendados
    ADD CONSTRAINT abordaje_agendados_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abordaje_agendados abordaje_agendados_prospecto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_agendados
    ADD CONSTRAINT abordaje_agendados_prospecto_id_fkey FOREIGN KEY (prospecto_id) REFERENCES public.abordaje_prospectos(id) ON DELETE CASCADE;


--
-- Name: abordaje_event_colors abordaje_event_colors_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_event_colors
    ADD CONSTRAINT abordaje_event_colors_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_event_colors abordaje_event_colors_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_event_colors
    ADD CONSTRAINT abordaje_event_colors_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: abordaje_maintenance_payments abordaje_maintenance_payments_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_maintenance_payments
    ADD CONSTRAINT abordaje_maintenance_payments_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: abordaje_prospecto_contactos abordaje_prospecto_contactos_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospecto_contactos
    ADD CONSTRAINT abordaje_prospecto_contactos_actor_fk FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_prospecto_contactos abordaje_prospecto_contactos_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospecto_contactos
    ADD CONSTRAINT abordaje_prospecto_contactos_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_prospecto_contactos abordaje_prospecto_contactos_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospecto_contactos
    ADD CONSTRAINT abordaje_prospecto_contactos_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abordaje_prospecto_contactos abordaje_prospecto_contactos_prospecto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospecto_contactos
    ADD CONSTRAINT abordaje_prospecto_contactos_prospecto_id_fkey FOREIGN KEY (prospecto_id) REFERENCES public.abordaje_prospectos(id) ON DELETE CASCADE;


--
-- Name: abordaje_prospectos abordaje_prospectos_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospectos
    ADD CONSTRAINT abordaje_prospectos_actor_fk FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_prospectos abordaje_prospectos_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospectos
    ADD CONSTRAINT abordaje_prospectos_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_prospectos abordaje_prospectos_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_prospectos
    ADD CONSTRAINT abordaje_prospectos_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abordaje_tareas abordaje_tareas_actor_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas
    ADD CONSTRAINT abordaje_tareas_actor_fk FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_tareas abordaje_tareas_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas
    ADD CONSTRAINT abordaje_tareas_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_tareas abordaje_tareas_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas
    ADD CONSTRAINT abordaje_tareas_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abordaje_tareas abordaje_tareas_columna_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas
    ADD CONSTRAINT abordaje_tareas_columna_id_fkey FOREIGN KEY (columna_id) REFERENCES public.abordaje_tareas_columnas(id) ON DELETE CASCADE;


--
-- Name: abordaje_tareas_columnas abordaje_tareas_columnas_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas_columnas
    ADD CONSTRAINT abordaje_tareas_columnas_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: abordaje_tareas_columnas abordaje_tareas_columnas_agente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas_columnas
    ADD CONSTRAINT abordaje_tareas_columnas_agente_id_fkey FOREIGN KEY (agente_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: abordaje_tareas abordaje_tareas_prospecto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.abordaje_tareas
    ADD CONSTRAINT abordaje_tareas_prospecto_id_fkey FOREIGN KEY (prospecto_id) REFERENCES public.abordaje_prospectos(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_assistant_of_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_assistant_of_id_fkey FOREIGN KEY (assistant_of_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_google_tokens user_google_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_google_tokens
    ADD CONSTRAINT user_google_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: career_scales career_admin_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY career_admin_select ON comisiones.career_scales FOR SELECT TO authenticated USING (private.is_admin());


--
-- Name: career_scales career_admin_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY career_admin_write ON comisiones.career_scales TO authenticated USING (private.is_admin()) WITH CHECK (private.is_admin());


--
-- Name: career_scales; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.career_scales ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_report_rows; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.custom_report_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: liquidation_rows; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.liquidation_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_report_rows owner_or_admin_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_select ON comisiones.custom_report_rows FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: liquidation_rows owner_or_admin_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_select ON comisiones.liquidation_rows FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: policy_status_overrides owner_or_admin_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_select ON comisiones.policy_status_overrides FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: simulator_config owner_or_admin_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_select ON comisiones.simulator_config FOR SELECT TO authenticated USING (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: custom_report_rows owner_or_admin_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_write ON comisiones.custom_report_rows TO authenticated USING (((auth.uid() = user_id) OR private.is_admin())) WITH CHECK (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: liquidation_rows owner_or_admin_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_write ON comisiones.liquidation_rows TO authenticated USING (((auth.uid() = user_id) OR private.is_admin())) WITH CHECK (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: policy_status_overrides owner_or_admin_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_write ON comisiones.policy_status_overrides TO authenticated USING (((auth.uid() = user_id) OR private.is_admin())) WITH CHECK (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: simulator_config owner_or_admin_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_or_admin_write ON comisiones.simulator_config TO authenticated USING (((auth.uid() = user_id) OR private.is_admin())) WITH CHECK (((auth.uid() = user_id) OR private.is_admin()));


--
-- Name: simulator_scenario owner_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_select ON comisiones.simulator_scenario FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: simulator_scenario owner_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY owner_write ON comisiones.simulator_scenario TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: policy_status_overrides; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.policy_status_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: simulator_saved_scenarios saved_owner_select; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY saved_owner_select ON comisiones.simulator_saved_scenarios FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: simulator_saved_scenarios saved_owner_write; Type: POLICY; Schema: comisiones; Owner: -
--

CREATE POLICY saved_owner_write ON comisiones.simulator_saved_scenarios TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: simulator_config; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.simulator_config ENABLE ROW LEVEL SECURITY;

--
-- Name: simulator_saved_scenarios; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.simulator_saved_scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: simulator_scenario; Type: ROW SECURITY; Schema: comisiones; Owner: -
--

ALTER TABLE comisiones.simulator_scenario ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_agendados; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_agendados ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_event_colors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_event_colors ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_maintenance_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_maintenance_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_prospecto_contactos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_prospecto_contactos ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_prospectos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_prospectos ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_tareas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_tareas ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_tareas_columnas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.abordaje_tareas_columnas ENABLE ROW LEVEL SECURITY;

--
-- Name: abordaje_maintenance_payments admin_delete_maintenance_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_delete_maintenance_payments ON public.abordaje_maintenance_payments FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: profiles admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert ON public.profiles FOR INSERT WITH CHECK (private.is_admin());


--
-- Name: abordaje_maintenance_payments admin_insert_maintenance_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_insert_maintenance_payments ON public.abordaje_maintenance_payments FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: profiles admin_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_select_all ON public.profiles FOR SELECT USING (private.is_admin());


--
-- Name: abordaje_maintenance_payments admin_select_maintenance_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_select_maintenance_payments ON public.abordaje_maintenance_payments FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: profiles admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update ON public.profiles FOR UPDATE USING (private.is_admin()) WITH CHECK (private.is_admin());


--
-- Name: abordaje_maintenance_payments admin_update_maintenance_payments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_update_maintenance_payments ON public.abordaje_maintenance_payments FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));


--
-- Name: abordaje_agendados agendados_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agendados_delete ON public.abordaje_agendados FOR DELETE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_agendados agendados_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agendados_insert ON public.abordaje_agendados FOR INSERT WITH CHECK (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_agendados agendados_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agendados_select ON public.abordaje_agendados FOR SELECT USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_agendados agendados_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agendados_update ON public.abordaje_agendados FOR UPDATE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas_columnas columnas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY columnas_delete ON public.abordaje_tareas_columnas FOR DELETE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas_columnas columnas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY columnas_insert ON public.abordaje_tareas_columnas FOR INSERT WITH CHECK (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas_columnas columnas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY columnas_select ON public.abordaje_tareas_columnas FOR SELECT USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas_columnas columnas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY columnas_update ON public.abordaje_tareas_columnas FOR UPDATE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospecto_contactos contactos_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contactos_delete ON public.abordaje_prospecto_contactos FOR DELETE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospecto_contactos contactos_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contactos_insert ON public.abordaje_prospecto_contactos FOR INSERT WITH CHECK (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospecto_contactos contactos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contactos_select ON public.abordaje_prospecto_contactos FOR SELECT USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospecto_contactos contactos_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contactos_update ON public.abordaje_prospecto_contactos FOR UPDATE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_event_colors event_colors_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_colors_delete ON public.abordaje_event_colors FOR DELETE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_event_colors event_colors_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_colors_insert ON public.abordaje_event_colors FOR INSERT WITH CHECK (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_event_colors event_colors_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_colors_select ON public.abordaje_event_colors FOR SELECT USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_event_colors event_colors_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY event_colors_update ON public.abordaje_event_colors FOR UPDATE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (((auth.uid() = id) OR private.is_admin() OR private.is_assistant_of(id)));


--
-- Name: abordaje_prospectos prospectos_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospectos_delete ON public.abordaje_prospectos FOR DELETE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospectos prospectos_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospectos_insert ON public.abordaje_prospectos FOR INSERT WITH CHECK (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospectos prospectos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospectos_select ON public.abordaje_prospectos FOR SELECT USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_prospectos prospectos_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY prospectos_update ON public.abordaje_prospectos FOR UPDATE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas tareas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tareas_delete ON public.abordaje_tareas FOR DELETE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas tareas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tareas_insert ON public.abordaje_tareas FOR INSERT WITH CHECK (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas tareas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tareas_select ON public.abordaje_tareas FOR SELECT USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: abordaje_tareas tareas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tareas_update ON public.abordaje_tareas FOR UPDATE USING (((agente_id = auth.uid()) OR private.is_admin() OR private.is_assistant_of(agente_id)));


--
-- Name: profiles update_own_metadata; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY update_own_metadata ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK (((auth.uid() = id) AND (role = ( SELECT profiles_1.role
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid()))) AND (NOT (assistant_of_id IS DISTINCT FROM ( SELECT profiles_1.assistant_of_id
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))) AND (email = ( SELECT profiles_1.email
   FROM public.profiles profiles_1
  WHERE (profiles_1.id = auth.uid())))));


--
-- Name: user_google_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_google_tokens ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict Lg1IWgYfZP19f0cdZruU7fqjh4GO68kzxEIQMAkfU3laoq2hpyl8qR74J2xFgYo

