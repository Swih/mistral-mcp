import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const FileUnavailable = z.object({
  type: z.literal("invalid_file"),
  code: z.literal("1901"),
  message: z.literal("Could not get file."),
});

function isFileUnavailable(error: unknown): boolean {
  const http = z.object({ statusCode: z.literal(422), body: z.string() }).safeParse(error);
  if (!http.success) return false;
  try {
    return FileUnavailable.safeParse(JSON.parse(http.data.body)).success;
  } catch {
    return false;
  }
}

// Upload success does not guarantee that the OCR service can fetch the file yet.
// Only the observed file-fetch error is retried; validation/auth/quota errors fail.
export async function waitForOcrFile(
  probe: () => Promise<unknown>,
  pause: (ms: number) => Promise<unknown> = delay,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await probe();
      return;
    } catch (error) {
      if (attempt === 3 || !isFileUnavailable(error)) throw error;
      console.error(`[live OCR fixture] File unavailable; retry ${attempt + 1}/3.`);
      await pause(1000 * 2 ** attempt);
    }
  }
}
