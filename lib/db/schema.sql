-- BaxterOps — Sprint 3 schema migration.
-- Ready to run against Supabase once provisioned. Until then the app reads/writes
-- the same shapes via lib/services/persistence.ts in localStorage fallback mode.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- competitor_field_tours
-- ============================================================
create table if not exists competitor_field_tours (
  id text primary key,
  competitor_id text not null,
  competitor_name text not null,
  tour_date date not null,
  collected_by text not null,
  assigned_to text,
  tour_status text not null check (tour_status in ('planned','in_progress','completed','cancelled')),
  source_label text not null,
  tour_booking_ease int,
  response_speed_hours int,
  kindness int,
  professionalism int,
  cleanliness int,
  tour_quality int,
  amenity_quality int,
  drinks_or_snacks_offered boolean,
  actual_concessions text,
  hidden_discounts text,
  parking_deal text,
  fees_waivable boolean,
  move_in_cost text,
  pressure_level text check (pressure_level in ('low','medium','high')),
  desperation_vs_confidence int,
  closing_strength int,
  follow_up_promised boolean,
  follow_up_received boolean,
  would_renter_choose_over_baxter boolean,
  why_or_why_not text,
  baxter_response_recommendation text,
  composite_experience_score numeric(3,1),
  field_confidence text not null check (field_confidence in ('high','medium','low','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_field_tours_competitor on competitor_field_tours (competitor_id);

-- ============================================================
-- competitor_unit_observations
-- ============================================================
create table if not exists competitor_unit_observations (
  id text primary key,
  competitor_id text not null,
  competitor_name text not null,
  field_tour_id text references competitor_field_tours(id) on delete cascade,
  unit_number text not null,
  unit_number_confidence text not null check (unit_number_confidence in ('high','medium','low','unknown')),
  floor int,
  bed_count int,
  bath_count int,
  square_feet int,
  asking_rent numeric(10,2),
  gross_rent numeric(10,2),
  effective_rent_13m_1free numeric(10,2),
  effective_rent_19m_2free numeric(10,2),
  effective_rent_13m_1free_look_and_lease numeric(10,2),
  effective_rent_19m_2free_look_and_lease numeric(10,2),
  look_and_lease_bonus numeric(10,2),
  look_and_lease_window_hours int,
  lease_months int,
  free_months int,
  availability_status text check (availability_status in ('available','not_ready','leased','needs_verification','unknown')),
  parking_included boolean,
  valet_included boolean,
  parking_spots_included int,
  water_included boolean,
  power_included boolean,
  gas_included boolean,
  internet_included boolean,
  in_unit_laundry boolean,
  balcony_or_patio boolean,
  smart_thermostat boolean,
  notes text,
  source_label text not null,
  source_date date,
  source_confidence text not null check (source_confidence in ('high','medium','low','unknown')),
  needs_verification boolean default false,
  data_quality_flags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_unit_obs_competitor on competitor_unit_observations (competitor_id);
create index if not exists idx_unit_obs_tour on competitor_unit_observations (field_tour_id);

-- ============================================================
-- competitor_amenity_observations
-- ============================================================
create table if not exists competitor_amenity_observations (
  id text primary key,
  competitor_id text not null,
  competitor_name text not null,
  field_tour_id text references competitor_field_tours(id) on delete cascade,
  amenity text not null,
  observed boolean not null,
  quality_score int,
  notes text,
  photo_evidence_ids text[] default '{}',
  source_label text not null,
  source_date date,
  source_confidence text not null check (source_confidence in ('high','medium','low','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_amenity_obs_competitor on competitor_amenity_observations (competitor_id);

-- ============================================================
-- photo_evidence
-- ============================================================
create table if not exists photo_evidence (
  id text primary key,
  competitor_id text not null,
  competitor_name text not null,
  field_tour_id text references competitor_field_tours(id) on delete cascade,
  property_id text,
  collection_id text not null,
  photo_order int not null,
  original_filename text not null,
  storage_path text,
  public_url text,
  category text not null,
  caption text,
  related_unit_number text,
  related_amenity text,
  observed_strengths text,
  observed_weaknesses text,
  marketing_usefulness_score int,
  comp_evidence_value_score int,
  data_confidence text not null check (data_confidence in ('high','medium','low','unknown')),
  source_label text not null,
  source_date date,
  uploaded_by text,
  tags text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_photo_evidence_collection_order on photo_evidence (collection_id, photo_order);
create index if not exists idx_photo_evidence_competitor on photo_evidence (competitor_id);

-- ============================================================
-- competitor_source_verifications
-- ============================================================
create table if not exists competitor_source_verifications (
  id text primary key,
  competitor_id text not null,
  source_type text not null,
  source_url text,
  source_name text,
  verified_at timestamptz,
  verified_by text,
  verification_status text not null check (verification_status in ('verified','partial','needs_review','needs_verification','rejected')),
  fields_verified text[] default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_source_ver_competitor on competitor_source_verifications (competitor_id);

-- ============================================================
-- data_quality_flags (extended from Sprint 2)
-- ============================================================
create table if not exists data_quality_flags (
  id text primary key,
  entity_type text,
  entity_id text,
  entity_name text,
  issue text not null,
  severity text not null check (severity in ('low','medium','high','critical')),
  status text not null check (status in ('open','acknowledged','fixed','needs_verification')),
  source text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists idx_flags_entity on data_quality_flags (entity_id);

-- ============================================================
-- RLS (commented — enable + write policies when Supabase auth is wired)
-- ============================================================
-- alter table competitor_field_tours enable row level security;
-- alter table competitor_unit_observations enable row level security;
-- alter table competitor_amenity_observations enable row level security;
-- alter table photo_evidence enable row level security;
-- alter table competitor_source_verifications enable row level security;
-- alter table data_quality_flags enable row level security;
