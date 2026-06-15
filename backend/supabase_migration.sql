-- AICoachy Supabase schema
-- Safe to run on a new or previously migrated project.
-- FastAPI is the only database access layer.

create extension if not exists pgcrypto;

create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null,
  target_id uuid null,
  role_title text not null,
  mode text not null default 'Full interview',
  difficulty text not null default 'Adaptive',
  interviewer_style text not null default 'Balanced',
  persona text not null default 'Friendly Interviewer',
  total_questions integer not null default 6
    check (total_questions between 3 and 8),
  status text not null default 'active'
    check (status in ('active', 'completed')),
  linked_parent_session_id uuid null
    references public.interview_sessions(id) on delete set null,
  practice_focus jsonb not null default '[]'::jsonb
    check (jsonb_typeof(practice_focus) = 'array'),
  is_weakness_practice boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.session_summaries (
  session_id uuid primary key
    references public.interview_sessions(id) on delete cascade,
  resume_improvement_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resume_improvement_json) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.interview_sessions
  add column if not exists persona text not null default 'Friendly Interviewer',
  add column if not exists linked_parent_session_id uuid null,
  add column if not exists practice_focus jsonb not null default '[]'::jsonb,
  add column if not exists is_weakness_practice boolean not null default false,
  add column if not exists completed_at timestamptz null;

alter table public.session_summaries
  add column if not exists resume_improvement_json jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.interview_sessions
  drop constraint if exists interview_sessions_persona_check;

alter table public.interview_sessions
  add constraint interview_sessions_persona_check check (
    persona in (
      'Friendly Interviewer',
      'Strict Technical Interviewer',
      'HR Recruiter',
      'Senior Engineering Manager',
      'FAANG-Style Interviewer'
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'interview_sessions_linked_parent_fkey'
      and conrelid = 'public.interview_sessions'::regclass
  ) then
    alter table public.interview_sessions
      add constraint interview_sessions_linked_parent_fkey
      foreign key (linked_parent_session_id)
      references public.interview_sessions(id)
      on delete set null;
  end if;
end $$;

create index if not exists interview_sessions_profile_created_idx
  on public.interview_sessions(profile_id, created_at desc);

create index if not exists interview_sessions_parent_idx
  on public.interview_sessions(linked_parent_session_id);

create index if not exists interview_sessions_weakness_idx
  on public.interview_sessions(is_weakness_practice)
  where is_weakness_practice = true;

comment on column public.interview_sessions.persona is
  'Controls question tone, scoring strictness, and feedback wording.';

comment on column public.interview_sessions.practice_focus is
  'Ordered list of weak skills targeted by a generated practice session.';

comment on column public.session_summaries.resume_improvement_json is
  'Role-specific resume evidence, missing skills, bullets, keywords, and project ideas.';

-- Browser-facing Supabase roles receive no direct table privileges.
alter table public.interview_sessions enable row level security;
alter table public.interview_sessions force row level security;
alter table public.session_summaries enable row level security;
alter table public.session_summaries force row level security;

revoke all on table public.interview_sessions from anon, authenticated;
revoke all on table public.session_summaries from anon, authenticated;

grant all on table public.interview_sessions to service_role;
grant all on table public.session_summaries to service_role;

-- service_role bypasses RLS. Do not add anon/authenticated policies unless
-- direct browser database access becomes an intentional design.
