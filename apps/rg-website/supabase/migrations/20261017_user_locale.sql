-- Langue préférée du compte (Better Auth `user.additionalFields.locale`).
--
-- Le cookie `rg-locale` ne suit qu'un navigateur : la colonne fait suivre la
-- langue choisie d'un appareil à l'autre dès la connexion. NULL = aucune
-- préférence enregistrée, le site retombe sur le cookie puis Accept-Language.
alter table public."user"
  add column if not exists locale text;

alter table public."user"
  drop constraint if exists user_locale_check;

alter table public."user"
  add constraint user_locale_check check (locale is null or locale in ('fr', 'en', 'ja'));
