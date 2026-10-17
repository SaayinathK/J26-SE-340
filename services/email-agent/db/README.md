# email-agent database

Own PostgreSQL/pgvector container: `email-agent-database`, database `email_agent`, host port `5434`. Configuration is in ignored `.env`; credentials are not shared with other database containers. Runtime data uses persistent volume `ciftron_email_agent_pgdata`.
