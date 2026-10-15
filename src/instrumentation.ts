export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startOutboxWorker } = await import("./lib/worker/outbox");
  startOutboxWorker();
}
