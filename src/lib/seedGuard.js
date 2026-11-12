export function assertDatabaseSeedingAllowed(nodeEnv, optInEnabled) {
  if (nodeEnv === 'production' || !optInEnabled) {
    throw new Error('Seeding is disabled. Explicit non-production opt-in is required.');
  }
}
