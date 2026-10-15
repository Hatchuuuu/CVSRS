import { AppError, safeMessage } from "./errors";

/** Read a request without ever buffering more than maxBytes of its UTF-8 payload. */
export async function readBoundedText(req: Request, maxBytes: number): Promise<string> {
  const tooLarge = () => new AppError("invalid_request", 413, "The request body is too large.");
  const declared = req.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw tooLarge();
  if (!req.body) throw new AppError("invalid_request", 400, safeMessage("invalid_request"));
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError("invalid_request", 400, safeMessage("invalid_request"));
  } finally {
    reader.releaseLock();
  }
}
