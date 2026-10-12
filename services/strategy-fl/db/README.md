# strategy-fl database

Own PostgreSQL/pgvector container: `strategy-fl-database`, database `strategy_fl`, host port `5437`. Configuration is in ignored `.env`; credentials are not shared with other database containers. Runtime data uses persistent volume `ciftron_strategy_fl_pgdata`.
