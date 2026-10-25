# services/lead-intel/src/repositories — where the lead history is stored
# get_repo() picks the C3 Postgres database when C3_DATABASE_URL is set, otherwise JSON-lines files.
from functools import lru_cache

from config import settings
from repositories.base import HistoryRepo, RepoUnavailable  # noqa: F401


@lru_cache(maxsize=1)
def get_repo() -> HistoryRepo:
    if settings.DATABASE_URL:
        from repositories.postgres_repo import PostgresHistoryRepo
        return PostgresHistoryRepo(settings.DATABASE_URL)
    from repositories.file_repo import FileHistoryRepo
    return FileHistoryRepo(settings.STATE_DIR)
