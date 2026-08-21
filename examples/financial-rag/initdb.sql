-- Two databases on one server. pgvector is enabled on ragapp and ONLY ragapp:
-- Ironflow's database never stores a vector, and this is where that is enforced.
CREATE DATABASE ragapp;
\connect ragapp
CREATE EXTENSION IF NOT EXISTS vector;
