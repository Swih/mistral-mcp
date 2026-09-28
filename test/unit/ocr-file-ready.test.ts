import { describe, expect, it, vi } from "vitest";
import { waitForOcrFile } from "../helpers/ocr-file-ready.js";

const unavailable = {
  statusCode: 422,
  body: JSON.stringify({ type: "invalid_file", code: "1901", message: "Could not get file." }),
};

describe("OCR fixture readiness", () => {
  it("waits for a newly uploaded file to become readable", async () => {
    const probe = vi.fn().mockRejectedValueOnce(unavailable).mockResolvedValue({ pages: [] });
    const pause = vi.fn().mockResolvedValue(undefined);
    await waitForOcrFile(probe, pause);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(pause).toHaveBeenCalledWith(1000);
  });

  it("fails after four attempts if the file stays unavailable", async () => {
    const probe = vi.fn().mockRejectedValue(unavailable);
    const pause = vi.fn().mockResolvedValue(undefined);
    await expect(waitForOcrFile(probe, pause)).rejects.toBe(unavailable);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(pause.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
  });

  it.each([
    { statusCode: 401, body: unavailable.body },
    { statusCode: 429, body: unavailable.body },
    { statusCode: 422, body: '{"detail":"Invalid document"}' },
    { statusCode: 422, body: 'not JSON' },
    new Error("network failure"),
  ])("does not hide other failures: %j", async (error) => {
    const probe = vi.fn().mockRejectedValue(error);
    const pause = vi.fn();
    await expect(waitForOcrFile(probe, pause)).rejects.toBe(error);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
  });
});
