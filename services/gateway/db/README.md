# gateway database

Own PostgreSQL/pgvector container: `gateway-database`, database `saas_platform`, host port `5433`. Configuration is in ignored `.env`; credentials are not shared with other database containers. Runtime data uses persistent volume `j26-se-340_development_c4_pgdata`.
