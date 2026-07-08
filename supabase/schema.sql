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
            new.published_at = coalesce(new.published_at, timezone('utc', now()));
        else
            new.published_at = null;
        end if;
        return new;
    end if;

    if new.visibility in ('public', 'unlisted') then
        if old.visibility in ('public', 'unlisted') then
            -- Edits to already-published modules must not bump published_at.
            new.published_at = coalesce(old.published_at, timezone('utc', now()));
        else
            -- First transition from private -> public/unlisted.
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
        nullif(trim(new.email), ''),
        'Explorer'
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
            nullif(trim(u.email), ''),
            'Explorer'
        ),
        80
    ),
    nullif(u.raw_user_meta_data ->> 'avatar_url', '')
from auth.users u
on conflict (id) do nothing;

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
    return coalesce(new, old);
end;
$$;

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

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
    on public.profiles
    for select
    using (true);

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
create policy "shared modules are readable by everyone"
    on public.modules
    for select
    using (visibility in ('public', 'unlisted'));

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
        and exists (
            select 1
            from public.modules m
            where m.id = module_id
              and m.visibility in ('public', 'unlisted')
              and m.owner_id <> auth.uid()
        )
    );

drop policy if exists "users can update their own ratings" on public.module_ratings;
create policy "users can update their own ratings"
    on public.module_ratings
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (
        auth.uid() = user_id
        and exists (
            select 1
            from public.modules m
            where m.id = module_id
              and m.visibility in ('public', 'unlisted')
              and m.owner_id <> auth.uid()
        )
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
        and exists (
            select 1
            from public.modules m
            where m.id = module_id
              and (
                  (
                      m.visibility in ('public', 'unlisted')
                      and m.owner_id <> auth.uid()
                  )
                  or exists (
                      select 1
                      from public.profiles p
                      where p.id = auth.uid()
                        and p.role = 'admin'::public.profile_role
                  )
              )
        )
    );

drop policy if exists "users can update their own subscriptions" on public.module_subscriptions;
create policy "users can update their own subscriptions"
    on public.module_subscriptions
    for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "users can delete their own subscriptions" on public.module_subscriptions;
create policy "users can delete their own subscriptions"
    on public.module_subscriptions
    for delete
    to authenticated
    using (auth.uid() = user_id);

commit;
