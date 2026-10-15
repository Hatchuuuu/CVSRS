-- Extensions the migrations call as extensions.* (unaccent, similarity/gin_trgm_ops, gen_random_bytes/hmac).
-- Supabase provides the extensions schema (and pgcrypto in it); pg_trgm and unaccent are not enabled on a new project.
-- Local and demo databases already get all three from supabase/bootstrap.sql, so every statement here is a no-op there.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
