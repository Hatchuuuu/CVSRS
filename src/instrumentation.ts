export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startOutboxWorker } = await import("./lib/worker/outbox");
    startOutboxWorker();
  }
}
