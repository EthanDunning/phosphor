-- STEP 1 (read-only): preview. One row per person; "matches" must be 1, and
-- "author_on_their_modules" shows what they typed in their modules' JSON.
with wanted(short_id, new_username) as (
    values
        ('e6c5280b', 'PurplePhoenix101'),
        ('0076de9d', 'Satan'),
        ('0263a387', 'Driveguy55'),
        ('d86c75b8', 'Christoffer'),
        ('7f4f399f', 'monomakes'),
        ('8cb68214', 'Mysterob'),
        ('b47cdc2c', 'Mighjusttry'),
        ('5dd54dc2', 'Daarkai'),
        ('046af555', 'Diego'),
        ('5f4aa025', 'Nick Kocis'),
        ('f21dc58c', 'WishyWashy'),
        ('2acb4267', '@orbulon'),
        ('a8925f87', '@an0zama')
)
select
    w.short_id,
    w.new_username,
    (select count(*) from public.profiles p2 where p2.id::text like w.short_id || '%') as matches,
    p.username as current_username,
    (select string_agg(distinct m.script_json -> 'config' ->> 'author', ' | ')
       from public.modules m where m.owner_id = p.id) as author_on_their_modules
from wanted w
left join public.profiles p on p.id::text like w.short_id || '%'
order by lower(w.new_username);


-- STEP 2: apply. Stops without changing anything if an id doesn't match
-- exactly one account.
do $$
declare
    r record;
    n integer;
begin
    for r in
        select * from (values
            ('e6c5280b', 'PurplePhoenix101'),
            ('0076de9d', 'Satan'),
            ('0263a387', 'Driveguy55'),
            ('d86c75b8', 'Christoffer'),
            ('7f4f399f', 'monomakes'),
            ('8cb68214', 'Mysterob'),
            ('b47cdc2c', 'Mighjusttry'),
            ('5dd54dc2', 'Daarkai'),
            ('046af555', 'Diego'),
            ('5f4aa025', 'Nick Kocis'),
            ('f21dc58c', 'WishyWashy'),
            ('2acb4267', '@orbulon'),
            ('a8925f87', '@an0zama')
        ) as t(short_id, new_username)
    loop
        select count(*) into n from public.profiles where id::text like r.short_id || '%';
        if n <> 1 then
            raise exception 'Short id % matches % accounts (expected 1). Nothing was changed.', r.short_id, n;
        end if;
        -- they chose these names themselves, so skip the "pick a username" popup
        update public.profiles
        set username = r.new_username, username_confirmed = true
        where id::text like r.short_id || '%';
    end loop;
end;
$$;


-- STEP 3: credit both @orbulon and @an0zama on module 3c9f6b6a-...
-- (whichever of them uploaded it is the owner; the other becomes co-author)
insert into public.module_authors (module_id, user_id, position)
select m.id, p.id, x.pos
from public.modules m
cross join (values ('2acb4267', 1), ('a8925f87', 2)) as x(short_id, pos)
join public.profiles p on p.id::text like x.short_id || '%'
where m.id = '3c9f6b6a-2584-436e-87eb-565b8933ba1a'
  and p.id <> m.owner_id
on conflict (module_id, user_id) do nothing;


-- CHECK: the credits as the Library will show them
select
    m.title,
    owner.username as owner,
    string_agg(co.username, ', ' order by a.position) as co_authors
from public.modules m
join public.profiles owner on owner.id = m.owner_id
left join public.module_authors a on a.module_id = m.id
left join public.profiles co on co.id = a.user_id
where m.id = '3c9f6b6a-2584-436e-87eb-565b8933ba1a'
group by m.title, owner.username;
