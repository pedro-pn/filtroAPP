export function buildDatabasePoolConfig(config) {
  return {
    connectionString: config.databaseUrl,
    max: config.databaseConnectionLimit,
    connectionTimeoutMillis: config.databaseConnectTimeoutMs,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    statement_timeout: config.databaseStatementTimeoutMs,
    lock_timeout: config.databaseLockTimeoutMs,
    idle_in_transaction_session_timeout: config.databaseIdleTransactionTimeoutMs,
    application_name: 'filtrovali-backend'
  };
}
