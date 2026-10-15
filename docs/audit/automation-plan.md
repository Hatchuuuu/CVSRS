# E14 automation and disposable database safety

Status: IMPLEMENTING. Preserve the user's development database and use project test databases only.

1. Add guard tests proving a connected server with a different data directory is rejected, including a missing/unreadable directory. The guard must run before reset and restore drops.
2. Make PostgreSQL binary resolution platform aware; accept PG_BIN on all platforms and PATH on Unix. Reject invalid ports before creating a connection.
3. Harden reset/restore connection cleanup with finally. Compare real resolved server data_directory with this checkout's .local/pgdata, rather than relying on a local marker.
4. Add Ubuntu CI using PostgreSQL binaries, Node 22, the project disposable cluster, complete checks, fresh migrations, matrix and production build. CI execution remains unverified until the hosted workflow runs.
5. Run guard units, types and lint locally; full regression after all migration edits settle. Independent reviewer must inspect destructive-operation sequencing.
