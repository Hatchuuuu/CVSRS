import { disposableTestName, reset, start } from "../../scripts/db";

// Rebuilds the throwaway test database from bootstrap + all migrations (clean-database path).
export default async function setup() {
  const name = disposableTestName(process.env.CVSRS_TEST_DB_NAME);
  start();
  await reset(name);
}
