# content-agent database

Own PostgreSQL/pgvector container: `content-agent-database`, database `content_agent`, host port `5435`. Configuration is in ignored `.env`; credentials are not shared with other database containers. Runtime data uses persistent volume `ciftron_content_agent_pgdata`.
