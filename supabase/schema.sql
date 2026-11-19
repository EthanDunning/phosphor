begin;

create extension if not exists pgcrypto;

create or replace function public.is_valid_phosphor_script(script jsonb)
returns boolean
language sql
immutable
as $$
    select
        coalesce(jsonb_typeof(script), '') = 'object'
        and coalesce(jsonb_typeof(script -> 'screens'), '') = 'array'
        and case
            when jsonb_typeof(script -> 'screens') = 'array' then jsonb_array_length(script -> 'screens') > 0
            else false
        end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

create or replace function public.set_module_publication_timestamp()
returns trigger
language plpgsql
as $$
begin
    if tg_op = 'INSERT' then
        if new.visibility in ('public', 'unlisted') then
            -- API clients can't backdate/future-date a module to the top of "newest".
            new.published_at = case
                when current_user in ('anon', 'authenticated') then timezone('utc', now())
                else coalesce(new.published_at, timezone('utc', now()))
            end;
        else
            new.published_at = null;
        end if;
        return new;
    end if;

    if new.visibility in ('public', 'unlisted') then
        if old.visibility in ('public', 'unlisted') then
            -- Edits to already-published modules must not bump published_at.
            new.published_at = coalesce(old.published_at, timezone('utc', now()));
        elsif current_user in ('anon', 'authenticated') then
            -- First transition from private -> public/unlisted (client-chosen dates ignored).
            new.published_at = coalesce(old.published_at, timezone('utc', now()));
        else
            new.published_at = coalesce(old.published_at, new.published_at, timezone('utc', now()));
        end if;
    else
        -- Private modules should not expose a publication timestamp.
        new.published_at = null;
    end if;

    return new;
end;
$$;

do $$
begin
    if not exists (
        select 1
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        where t.typname = 'profile_role'
          and n.nspname = 'public'
    ) then
        create type public.profile_role as enum ('user', 'admin');
    end if;
end;
$$;

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text not null check (char_length(trim(display_name)) between 1 and 80),
    avatar_url text,
    role public.profile_role not null default 'user'::public.profile_role,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.modules (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles (id) on delete cascade,
    title text not null check (char_length(trim(title)) between 1 and 120),
    summary text not null default '' check (char_length(summary) <= 500),
    script_json jsonb not null check (public.is_valid_phosphor_script(script_json)),
    cover_image_url text,
    visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
    rating_count integer not null default 0 check (rating_count >= 0),
    rating_average numeric(3, 2) not null default 0 check (rating_average >= 0 and rating_average <= 5),
    subscription_count integer not null default 0 check (subscription_count >= 0),
    published_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.modules
    drop constraint if exists modules_visibility_check;

alter table public.modules
    add constraint modules_visibility_check
    check (visibility in ('private', 'unlisted', 'public'));

create table if not exists public.module_ratings (
    module_id uuid not null references public.modules (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    rating smallint not null check (rating between 1 and 5),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (module_id, user_id)
);

create table if not exists public.module_subscriptions (
    module_id uuid not null references public.modules (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (module_id, user_id)
);

alter table public.profiles
    add column if not exists role public.profile_role;

alter table public.profiles
    drop constraint if exists profiles_role_check;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'role'
          and udt_name <> 'profile_role'
    ) then
        alter table public.profiles
            alter column role drop default;

        alter table public.profiles
            alter column role type public.profile_role
            using (
                case
                    when role::text = 'admin' then 'admin'::public.profile_role
                    else 'user'::public.profile_role
                end
            );
    end if;
end;
$$;

update public.profiles
set role = 'user'::public.profile_role
where role is null;

alter table public.profiles
    alter column role set default 'user'::public.profile_role,
    alter column role set not null;

create index if not exists modules_owner_id_idx
    on public.modules (owner_id);

create index if not exists modules_visibility_updated_at_idx
    on public.modules (visibility, updated_at desc);

create index if not exists module_ratings_user_id_idx
    on public.module_ratings (user_id);

create index if not exists module_subscriptions_user_id_idx
    on public.module_subscriptions (user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    next_display_name text;
begin
    next_display_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'preferred_username'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        -- never fall back to the email: profiles are publicly readable
        'Explorer-' || left(new.id::text, 8)
    );

    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        left(next_display_name, 80),
        nullif(new.raw_user_meta_data ->> 'avatar_url', '')
    )
    on conflict (id) do update
    set
        display_name = excluded.display_name,
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = timezone('utc', now());

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

insert into public.profiles (id, display_name, avatar_url)
select
    u.id,
    left(
        coalesce(
            nullif(trim(u.raw_user_meta_data ->> 'user_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'preferred_username'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
            'Explorer-' || left(u.id::text, 8)
        ),
        80
    ),
    nullif(u.raw_user_meta_data ->> 'avatar_url', '')
from auth.users u
on conflict (id) do nothing;

-- One-time privacy fix (safe to re-run): profiles created by the old email
-- fallback exposed the address as a public display name.
update public.profiles p
set display_name = 'Explorer-' || left(p.id::text, 8)
from auth.users u
where u.id = p.id
  and u.email is not null
  and lower(trim(p.display_name)) = lower(trim(u.email));

create or replace function public.recalculate_module_rating_stats(target_module_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.modules
    set
        rating_count = (
            select count(*)::integer
            from public.module_ratings
            where module_id = target_module_id
        ),
        rating_average = coalesce((
            select round(avg(rating)::numeric, 2)
            from public.module_ratings
            where module_id = target_module_id
        ), 0)
    where id = target_module_id;
end;
$$;

create or replace function public.recalculate_module_subscription_count(target_module_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.modules
    set subscription_count = (
        select count(*)::integer
        from public.module_subscriptions
        where module_id = target_module_id
    )
    where id = target_module_id;
end;
$$;

create or replace function public.handle_module_rating_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.recalculate_module_rating_stats(coalesce(new.module_id, old.module_id));
    -- a rating moved to another module: the old module's stats change too
    if tg_op = 'UPDATE' and old.module_id is distinct from new.module_id then
        perform public.recalculate_module_rating_stats(old.module_id);
    end if;
    return coalesce(new, old);
end;
$$;

create or replace function public.handle_module_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.recalculate_module_subscription_count(coalesce(new.module_id, old.module_id));
    if tg_op = 'UPDATE' and old.module_id is distinct from new.module_id then
        perform public.recalculate_module_subscription_count(old.module_id);
    end if;
    return coalesce(new, old);
end;
$$;

-- Only the triggers above should run these (they're security definer, so they
-- would otherwise be callable by anyone over RPC as a cheap load amplifier).
revoke execute on function public.recalculate_module_rating_stats(uuid) from public, anon, authenticated;
revoke execute on function public.recalculate_module_subscription_count(uuid) from public, anon, authenticated;

-- Unlisted modules are link-only: the table's select policy exposes only
-- public rows, and shared (public/unlisted) modules are fetched by id here, so
-- they can't be enumerated with a bare `visibility=eq.unlisted` query.
create or replace function public.get_shared_modules(module_ids uuid[])
returns setof public.modules
language sql
stable
security definer
set search_path = public
as $$
    select m.*
    from public.modules m
    where m.id = any(module_ids[1:200])
      and m.visibility in ('public', 'unlisted');
$$;

revoke execute on function public.get_shared_modules(uuid[]) from public;
grant execute on function public.get_shared_modules(uuid[]) to anon, authenticated;

-- Used by the rating/subscription policies: their subqueries run under the
-- caller's RLS, which no longer reveals unlisted modules.
create or replace function public.is_module_shared_with_caller(target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.modules m
        where m.id = target_module_id
          and m.visibility in ('public', 'unlisted')
          and m.owner_id <> auth.uid()
    );
$$;

revoke execute on function public.is_module_shared_with_caller(uuid) from public;
grant execute on function public.is_module_shared_with_caller(uuid) to authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
    before update on public.profiles
    for each row execute procedure public.set_updated_at();

drop trigger if exists modules_set_updated_at on public.modules;
create trigger modules_set_updated_at
    before update on public.modules
    for each row execute procedure public.set_updated_at();

drop trigger if exists modules_set_publication_timestamp on public.modules;
create trigger modules_set_publication_timestamp
    before insert or update on public.modules
    for each row execute procedure public.set_module_publication_timestamp();

-- Rating/subscription counters are owned by the recalculate_* functions (which
-- run as the table owner via security definer). Requests from API roles can't
-- write them, so an owner can't inflate their module's rank with a direct
-- UPDATE. Deliberately NOT security definer: current_user must be the caller.
create or replace function public.protect_module_counters()
returns trigger
language plpgsql
as $$
begin
    if current_user in ('anon', 'authenticated') then
        if tg_op = 'INSERT' then
            new.rating_count = 0;
            new.rating_average = 0;
            new.subscription_count = 0;
        else
            new.rating_count = old.rating_count;
            new.rating_average = old.rating_average;
            new.subscription_count = old.subscription_count;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists modules_protect_counters on public.modules;
create trigger modules_protect_counters
    before insert or update on public.modules
    for each row execute procedure public.protect_module_counters();

-- Server-side cap matching the client's 5 MB limit (NOT VALID: existing rows
-- aren't re-checked, new writes are).
alter table public.modules
    drop constraint if exists modules_script_json_size;

alter table public.modules
    add constraint modules_script_json_size
    check (octet_length(script_json::text) <= 5 * 1024 * 1024) not valid;

drop trigger if exists module_ratings_set_updated_at on public.module_ratings;
create trigger module_ratings_set_updated_at
    before update on public.module_ratings
    for each row execute procedure public.set_updated_at();

drop trigger if exists module_subscriptions_set_updated_at on public.module_subscriptions;
create trigger module_subscriptions_set_updated_at
    before update on public.module_subscriptions
    for each row execute procedure public.set_updated_at();

drop trigger if exists module_ratings_refresh_stats on public.module_ratings;
create trigger module_ratings_refresh_stats
    after insert or update or delete on public.module_ratings
    for each row execute procedure public.handle_module_rating_change();

drop trigger if exists module_subscriptions_refresh_count on public.module_subscriptions;
create trigger module_subscriptions_refresh_count
    after insert or update or delete on public.module_subscriptions
    for each row execute procedure public.handle_module_subscription_change();

alter table public.profiles enable row level security;

alter table public.modules enable row level security;

alter table public.module_ratings enable row level security;

alter table public.module_subscriptions enable row level security;

-- Profiles used to be readable by everyone, which let anyone list every
-- account. Reads are now limited; the policy is created with the usernames
-- section near the end of this file (it needs functions defined there).
drop policy if exists "profiles are publicly readable" on public.profiles;

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
    on public.profiles
    for insert
    to authenticated
    with check (auth.uid() = id and role = 'user');

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
    on public.profiles
    for update
    to authenticated
    using (auth.uid() = id and role = 'user')
    with check (auth.uid() = id and role = 'user');

drop policy if exists "admins can update their own profile" on public.profiles;
create policy "admins can update their own profile"
    on public.profiles
    for update
    to authenticated
    using (auth.uid() = id and role = 'admin')
    with check (auth.uid() = id and role = 'admin');

drop policy if exists "public modules are readable by everyone" on public.modules;
drop policy if exists "shared modules are readable by everyone" on public.modules;
-- unlisted modules are served by id through public.get_shared_modules()
create policy "public modules are readable by everyone"
    on public.modules
    for select
    using (visibility = 'public');

drop policy if exists "owners can read their own modules" on public.modules;
create policy "owners can read their own modules"
    on public.modules
    for select
    to authenticated
    using (auth.uid() = owner_id);

drop policy if exists "admins can read all modules" on public.modules;
create policy "admins can read all modules"
    on public.modules
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'
        )
    );

drop policy if exists "owners can insert their own modules" on public.modules;
create policy "owners can insert their own modules"
    on public.modules
    for insert
    to authenticated
    with check (auth.uid() = owner_id);

drop policy if exists "owners can update their own modules" on public.modules;
create policy "owners can update their own modules"
    on public.modules
    for update
    to authenticated
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

drop policy if exists "owners can delete their own modules" on public.modules;
create policy "owners can delete their own modules"
    on public.modules
    for delete
    to authenticated
    using (auth.uid() = owner_id);

drop policy if exists "admins can update all modules" on public.modules;
create policy "admins can update all modules"
    on public.modules
    for update
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'
        )
    )
    with check (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'
        )
    );

drop policy if exists "admins can delete all modules" on public.modules;
create policy "admins can delete all modules"
    on public.modules
    for delete
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'
        )
    );

drop policy if exists "users can read their own ratings" on public.module_ratings;
create policy "users can read their own ratings"
    on public.module_ratings
    for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "users can rate public modules" on public.module_ratings;
create policy "users can rate public modules"
    on public.module_ratings
    for insert
    to authenticated
    with check (
        auth.uid() = user_id
        and public.is_module_shared_with_caller(module_id)
    );

drop policy if exists "users can update their own ratings" on public.module_ratings;
create policy "users can update their own ratings"
    on public.module_ratings
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and public.is_module_shared_with_caller(module_id)
    );

drop policy if exists "users can delete their own ratings" on public.module_ratings;
create policy "users can delete their own ratings"
    on public.module_ratings
    for delete
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "users can read their own subscriptions" on public.module_subscriptions;
create policy "users can read their own subscriptions"
    on public.module_subscriptions
    for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "users can subscribe to public modules" on public.module_subscriptions;
create policy "users can subscribe to public modules"
    on public.module_subscriptions
    for insert
    to authenticated
    with check (
        auth.uid() = user_id
        and (
            public.is_module_shared_with_caller(module_id)
            or exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'admin'::public.profile_role
            )
        )
    );

-- same rule as insert, so a subscription can't be re-pointed at a module the
-- user couldn't subscribe to directly
drop policy if exists "users can update their own subscriptions" on public.module_subscriptions;
create policy "users can update their own subscriptions"
    on public.module_subscriptions
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and (
            public.is_module_shared_with_caller(module_id)
            or exists (
                select 1
                from public.profiles p
                where p.id = auth.uid()
                  and p.role = 'admin'::public.profile_role
            )
        )
    );

drop policy if exists "users can delete their own subscriptions" on public.module_subscriptions;
create policy "users can delete their own subscriptions"
    on public.module_subscriptions
    for delete
    to authenticated
    using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Feedback: bug reports, feature requests and general feedback sent from the
-- app's [FEEDBACK] button. Any signed-in user can send feedback and read
-- their own (with its status and the admins' response); only admins can read
-- everyone's, set the status, respond, or delete.
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
    id uuid primary key default gen_random_uuid(),
    user_id uuid default auth.uid() references auth.users (id) on delete set null,
    contact_email text,
    kind text not null,
    message text not null,
    context jsonb not null default '{}'::jsonb,
    status text not null default 'new',
    response text,
    responded_at timestamptz,
    responded_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint feedback_kind_check check (kind in ('bug', 'feature', 'general')),
    constraint feedback_status_check check (status in ('new', 'in_progress', 'resolved', 'closed')),
    constraint feedback_message_length check (char_length(btrim(message)) between 1 and 4000),
    constraint feedback_context_shape check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 4096)
);

create index if not exists feedback_created_at_idx on public.feedback (created_at desc);
create index if not exists feedback_user_id_idx on public.feedback (user_id, created_at desc);

-- response columns for tables created before responses existed
alter table public.feedback add column if not exists response text;
alter table public.feedback add column if not exists responded_at timestamptz;
alter table public.feedback add column if not exists responded_by uuid references auth.users (id) on delete set null;

alter table public.feedback drop constraint if exists feedback_response_length;
alter table public.feedback
    add constraint feedback_response_length check (response is null or char_length(response) <= 4000);

-- Inserts from the app: the sender is always the signed-in caller (their email
-- is copied from auth.users so admins can reply), a new message always starts
-- as 'new' with no response, and a user can send at most 10 per hour. Updates
-- (admins only, via RLS) may change just the status and the response; the
-- responder and time are stamped here. Security definer so it can read
-- auth.users and count the caller's recent rows.
create or replace function public.handle_feedback_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    recent_count integer;
begin
    if tg_op = 'INSERT' then
        if auth.uid() is not null then
            new.user_id := auth.uid();
            new.contact_email := (select u.email from auth.users u where u.id = auth.uid());
            new.status := 'new';
            new.response := null;
            new.responded_at := null;
            new.responded_by := null;
            new.created_at := now();
            new.updated_at := new.created_at;

            select count(*) into recent_count
            from public.feedback f
            where f.user_id = auth.uid()
              and f.created_at > now() - interval '1 hour';

            if recent_count >= 10 then
                raise exception 'Too much feedback sent in the last hour. Please try again later.'
                    using errcode = 'P0001';
            end if;
        end if;
        return new;
    end if;

    -- UPDATE: keep everything the sender wrote; only the status and the
    -- response move, and the response is stamped with who wrote it and when
    new.id := old.id;
    new.user_id := old.user_id;
    new.contact_email := old.contact_email;
    new.kind := old.kind;
    new.message := old.message;
    new.context := old.context;
    new.created_at := old.created_at;
    new.updated_at := now();

    new.response := nullif(btrim(coalesce(new.response, '')), '');
    if new.response is distinct from old.response then
        if new.response is null then
            new.responded_at := null;
            new.responded_by := null;
        else
            new.responded_at := now();
            new.responded_by := auth.uid();
        end if;
    else
        new.responded_at := old.responded_at;
        new.responded_by := old.responded_by;
    end if;
    return new;
end;
$$;

drop trigger if exists feedback_handle_write on public.feedback;
create trigger feedback_handle_write
    before insert or update on public.feedback
    for each row execute procedure public.handle_feedback_write();

alter table public.feedback enable row level security;

-- nothing for signed-out visitors
revoke all on table public.feedback from anon;

drop policy if exists "signed-in users can send feedback" on public.feedback;
create policy "signed-in users can send feedback"
    on public.feedback
    for insert
    to authenticated
    with check (user_id = auth.uid() and status = 'new');

drop policy if exists "users can read their own feedback" on public.feedback;
create policy "users can read their own feedback"
    on public.feedback
    for select
    to authenticated
    using (user_id = auth.uid());

drop policy if exists "admins can read feedback" on public.feedback;
create policy "admins can read feedback"
    on public.feedback
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'::public.profile_role
        )
    );

drop policy if exists "admins can update feedback" on public.feedback;
create policy "admins can update feedback"
    on public.feedback
    for update
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'::public.profile_role
        )
    )
    with check (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'::public.profile_role
        )
    );

drop policy if exists "admins can delete feedback" on public.feedback;
create policy "admins can delete feedback"
    on public.feedback
    for delete
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.id = auth.uid()
              and p.role = 'admin'::public.profile_role
        )
    );

-- ---------------------------------------------------------------------------
-- Usernames: the public name shown as "By ..." in the Library. Unique
-- (ignoring case), editable in the account dropdown. New and existing
-- accounts get a generated one (e.g. "AmberRelay4821"); it is never derived
-- from the email, because profiles are publicly readable.
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;

create or replace function public.generate_username()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
    adjectives text[] := array[
        'amber', 'quiet', 'static', 'hollow', 'lunar', 'rusty', 'neon', 'silent',
        'distant', 'cold', 'feral', 'dim', 'brass', 'vacant', 'polar', 'orbital',
        'faded', 'drifting', 'iron', 'pale', 'crimson', 'cobalt', 'stray', 'deep'
    ];
    nouns text[] := array[
        'relay', 'signal', 'beacon', 'vector', 'station', 'comet', 'drone', 'cipher',
        'module', 'array', 'probe', 'outpost', 'reactor', 'hull', 'console', 'airlock',
        'sensor', 'orbit', 'vault', 'tracer', 'pulse', 'lantern', 'harbor', 'echo'
    ];
    candidate text;
    attempt integer := 0;
begin
    loop
        candidate := initcap(adjectives[1 + floor(random() * array_length(adjectives, 1))::int])
            || initcap(nouns[1 + floor(random() * array_length(nouns, 1))::int])
            || (1000 + floor(random() * 9000))::int::text;
        exit when not exists (select 1 from public.profiles p where lower(p.username) = lower(candidate));
        attempt := attempt + 1;
        if attempt >= 25 then
            candidate := candidate || substr(md5(random()::text), 1, 4);
            exit;
        end if;
    end loop;
    return candidate;
end;
$$;

-- everyone gets one, and new profiles get one automatically
update public.profiles set username = public.generate_username() where username is null;
alter table public.profiles alter column username set default public.generate_username();
alter table public.profiles alter column username set not null;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
    add constraint profiles_username_format check (
        username = btrim(username)
        and char_length(username) between 2 and 32
        and username ~ '^@?[A-Za-z0-9][A-Za-z0-9 _.-]*$'
        and username !~ '\s{2,}'
        and lower(ltrim(username, '@')) not in ('admin', 'administrator', 'phosphor', 'support', 'moderator', 'system', 'staff')
    );

create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

-- false until the person has chosen a username or kept the generated one; the
-- app asks them once (a popup after signing in) while this is false
alter table public.profiles add column if not exists username_confirmed boolean not null default false;

-- ---------------------------------------------------------------------------
-- Module co-authors: people the owner credits on a module ("By A & B"). The
-- owner (or an admin) adds and removes them; anyone tagged can remove
-- themselves. Up to 8 per module, and never the owner (who is always first).
-- ---------------------------------------------------------------------------
create table if not exists public.module_authors (
    module_id uuid not null references public.modules (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    position smallint not null default 0,
    created_at timestamptz not null default now(),
    primary key (module_id, user_id)
);

create index if not exists module_authors_user_id_idx on public.module_authors (user_id);

-- visible module = public/unlisted, or yours, or you're an admin
create or replace function public.can_view_module(target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.modules m
        where m.id = target_module_id
          and (
              m.visibility in ('public', 'unlisted')
              or m.owner_id = auth.uid()
              or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'::public.profile_role)
          )
    );
$$;

create or replace function public.can_manage_module(target_module_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.modules m
        where m.id = target_module_id
          and (
              m.owner_id = auth.uid()
              or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'::public.profile_role)
          )
    );
$$;

revoke execute on function public.can_view_module(uuid) from public;
grant execute on function public.can_view_module(uuid) to anon, authenticated;
revoke execute on function public.can_manage_module(uuid) from public;
grant execute on function public.can_manage_module(uuid) to authenticated;

create or replace function public.check_module_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if exists (select 1 from public.modules m where m.id = new.module_id and m.owner_id = new.user_id) then
        raise exception 'The owner is already credited on this module.' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT'
       and (select count(*) from public.module_authors a where a.module_id = new.module_id) >= 8 then
        raise exception 'A module can credit up to 8 co-authors.' using errcode = 'P0001';
    end if;
    return new;
end;
$$;

drop trigger if exists module_authors_check on public.module_authors;
create trigger module_authors_check
    before insert or update on public.module_authors
    for each row execute procedure public.check_module_author();

alter table public.module_authors enable row level security;

drop policy if exists "module credits are readable with the module" on public.module_authors;
create policy "module credits are readable with the module"
    on public.module_authors
    for select
    to anon, authenticated
    using (public.can_view_module(module_id) or user_id = auth.uid());

drop policy if exists "owners and admins can credit co-authors" on public.module_authors;
create policy "owners and admins can credit co-authors"
    on public.module_authors
    for insert
    to authenticated
    with check (public.can_manage_module(module_id));

drop policy if exists "owners and admins can reorder co-authors" on public.module_authors;
create policy "owners and admins can reorder co-authors"
    on public.module_authors
    for update
    to authenticated
    using (public.can_manage_module(module_id))
    with check (public.can_manage_module(module_id));

drop policy if exists "owners, admins and the co-author can remove a credit" on public.module_authors;
create policy "owners, admins and the co-author can remove a credit"
    on public.module_authors
    for delete
    to authenticated
    using (public.can_manage_module(module_id) or user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Who can read profiles. Not everyone any more: that exposed every account
-- (and display names, which can be real names). A profile is readable by its
-- owner, by admins, and - only so "By ..." credits can show usernames - when
-- the person owns or is credited on a public or unlisted module. Tagging a
-- co-author needs their full account id (see find_account_by_id below).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'admin'::public.profile_role
    );
$$;

create or replace function public.is_credited_author(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.modules m
        where m.owner_id = target_profile_id
          and m.visibility in ('public', 'unlisted')
    ) or exists (
        select 1
        from public.module_authors a
        join public.modules m on m.id = a.module_id
        where a.user_id = target_profile_id
          and m.visibility in ('public', 'unlisted')
    );
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
revoke execute on function public.is_credited_author(uuid) from public;
grant execute on function public.is_credited_author(uuid) to anon, authenticated;

drop policy if exists "profiles are readable by their owner, admins, or when credited" on public.profiles;
create policy "profiles are readable by their owner, admins, or when credited"
    on public.profiles
    for select
    to anon, authenticated
    using (
        id = auth.uid()
        or public.is_admin()
        or public.is_credited_author(id)
    );

-- Tagging a co-author: look someone up by their FULL account id (shown in
-- their own account menu). Exact match only, signed-in callers only, and it
-- returns just the id + username - nothing to browse or search.
create or replace function public.find_account_by_id(account_id uuid)
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = public
as $$
    select p.id, p.username
    from public.profiles p
    where p.id = account_id
      and auth.uid() is not null;
$$;

revoke execute on function public.find_account_by_id(uuid) from public, anon;
grant execute on function public.find_account_by_id(uuid) to authenticated;

commit;
