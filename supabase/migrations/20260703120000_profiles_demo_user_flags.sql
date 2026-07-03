-- Usuario de ejemplo (demo) para onboarding de agentes nuevos.
-- is_demo:     marca el perfil como la cuenta demo (datos ficticios).
-- demo_active: switch (Ajustes → admin). OFF oculta el demo de las listas de
--              admin (loadAllProfiles / prodAgentes / matriz de pagos) y bloquea
--              su login (AppShell). ON lo hace visible y habilita el login.

alter table profiles add column if not exists is_demo boolean not null default false;
alter table profiles add column if not exists demo_active boolean not null default false;
