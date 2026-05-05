/**
 * Unit tests for v0.4 audio tools (Voxtral STT + TTS) with a mocked Mistral client.
 */

import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Mistral } from "@mistralai/mistralai";
import { registerAudioTools } from "../../src/tools-audio.js";
import { STT_MODELS } from "../../src/models.js";
import type { MistralProfile } from "../../src/profile.js";

function makeMock(): Mistral {
  return {
    audio: {
      transcriptions: {
        complete: vi.fn(async () => ({
          model: "voxtral-mini-latest",
          text: "Bonjour, ceci est un test.",
          language: "fr",
          segments: [
            {
              type: "transcription_segment",
              text: "Bonjour,",
              start: 0,
              end: 0.8,
              score: 0.97,
              speakerId: "spk_0",
            },
            {
              type: "transcription_segment",
              text: "ceci est un test.",
              start: 0.9,
              end: 2.4,
              score: 0.95,
              speakerId: "spk_0",
            },
          ],
          usage: { promptTokens: 0, completionTokens: 32, totalTokens: 32 },
        })),
      },
      speech: {
        complete: vi.fn(async () => ({
          audioData: "SGVsbG8sIFdvcmxkIQ==",
        })),
      },
    },
  } as unknown as Mistral;
}

async function boot(mock: Mistral = makeMock(), profile: MistralProfile = "admin") {
  const server = new McpServer({ name: "audio-test", version: "0.0.0" });
  registerAudioTools(server, mock, profile);
  const client = new Client({ name: "c", version: "0.0.0" });
  const [st, ct] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, mock };
}

describe("tool listing (audio)", () => {
  it("admin profile exposes voxtral_transcribe and voxtral_speak", async () => {
    const { client } = await boot(makeMock(), "admin");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["voxtral_speak", "voxtral_transcribe"]);
    for (const t of tools) {
      expect(t.outputSchema).toBeTruthy();
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.openWorldHint).toBe(true);
    }
  });

  it("core profile exposes only voxtral_transcribe", async () => {
    const { client } = await boot(makeMock(), "core");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(["voxtral_transcribe"]);
  });
});

describe("voxtral_transcribe", () => {
  it("accepts file_url and returns structured transcription", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "voxtral_transcribe",
      arguments: {
        audio: {
          type: "file_url",
          fileUrl: "https://example.com/hello.mp3",
        },
        language: "fr",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      text: string;
      model: string;
      language: string | null;
      segments?: Array<{ text: string; start: number; end: number }>;
      usage?: { totalTokens?: number };
    };
    expect(sc.text).toContain("Bonjour");
    expect(sc.language).toBe("fr");
    expect(sc.model).toBe("voxtral-mini-latest");
    expect(sc.segments?.length).toBe(2);
    expect(sc.segments?.[0]?.text).toContain("Bonjour");
    expect(sc.usage?.totalTokens).toBe(32);

    const arg = (
      mock.audio.transcriptions.complete as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(arg?.fileUrl).toBe("https://example.com/hello.mp3");
    expect(arg?.language).toBe("fr");
    expect(arg?.model).toBe("voxtral-mini-latest"); // default
  });

  it("accepts file fileId input (from Files API)", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "voxtral_transcribe",
      arguments: {
        audio: { type: "file", fileId: "file_abc" },
      },
    });
    expect(result.isError).toBeFalsy();
    const arg = (
      mock.audio.transcriptions.complete as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(arg?.fileId).toBe("file_abc");
    expect(arg?.fileUrl).toBeUndefined();
  });

  it("forwards diarize, temperature, contextBias, timestampGranularities", async () => {
    const { client, mock } = await boot();
    await client.callTool({
      name: "voxtral_transcribe",
      arguments: {
        audio: { type: "file_url", fileUrl: "https://example.com/x.wav" },
        diarize: true,
        temperature: 0.2,
        contextBias: ["Paris", "Louvre"],
        timestampGranularities: ["segment"],
      },
    });
    const arg = (
      mock.audio.transcriptions.complete as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(arg?.diarize).toBe(true);
    expect(arg?.temperature).toBe(0.2);
    expect(arg?.contextBias).toEqual(["Paris", "Louvre"]);
    expect(arg?.timestampGranularities).toEqual(["segment"]);
  });

  it("accepts every STT model alias", async () => {
    const { client } = await boot();
    for (const model of STT_MODELS) {
      const result = await client.callTool({
        name: "voxtral_transcribe",
        arguments: {
          audio: { type: "file_url", fileUrl: "https://example.com/a.mp3" },
          model,
        },
      });
      expect(result.isError).toBeFalsy();
    }
  });

  it("rejects a non-STT model", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "voxtral_transcribe",
      arguments: {
        audio: { type: "file_url", fileUrl: "https://example.com/a.mp3" },
        model: "mistral-large-latest",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("rejects missing audio source", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "voxtral_transcribe",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (
      mock.audio.transcriptions.complete as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("audio_too_long"));
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "voxtral_transcribe",
      arguments: {
        audio: { type: "file_url", fileUrl: "https://example.com/x.mp3" },
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("audio_too_long");
    expect(text).toContain("voxtral_transcribe");
  });
});

describe("voxtral_speak", () => {
  it("synthesizes audio and returns base64 + mime type", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "voxtral_speak",
      arguments: {
        input: "Bonjour tout le monde.",
        voiceId: "amelie",
      },
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      audio_base64: string;
      mime_type: string;
      format: string;
      voice_id?: string;
    };
    expect(sc.audio_base64).toBe("SGVsbG8sIFdvcmxkIQ==");
    expect(sc.mime_type).toBe("audio/mpeg"); // default format = mp3
    expect(sc.format).toBe("mp3");
    expect(sc.voice_id).toBe("amelie");

    const arg = (mock.audio.speech.complete as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.input).toBe("Bonjour tout le monde.");
    expect(arg?.voiceId).toBe("amelie");
    expect(arg?.responseFormat).toBe("mp3");
    expect(arg?.stream).toBe(false);

    const summary = (result.content as Array<{ text?: string }>)[0]?.text ?? "";
    expect(summary).toContain("13 byte(s)");
  });

  it("emits an audio content block alongside the structured payload", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "voxtral_speak",
      arguments: { input: "Salut" },
    });
    expect(result.isError).toBeFalsy();
    const parts = result.content as Array<{
      type: string;
      data?: string;
      mimeType?: string;
    }>;
    const audioPart = parts.find((p) => p.type === "audio");
    expect(audioPart).toBeTruthy();
    expect(audioPart?.mimeType).toBe("audio/mpeg");
    expect(audioPart?.data).toBe("SGVsbG8sIFdvcmxkIQ==");
  });

  it("honors a non-default responseFormat (wav → audio/wav)", async () => {
    const { client, mock } = await boot();
    const result = await client.callTool({
      name: "voxtral_speak",
      arguments: { input: "Salut", responseFormat: "wav" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { mime_type: string; format: string };
    expect(sc.format).toBe("wav");
    expect(sc.mime_type).toBe("audio/wav");
    const arg = (mock.audio.speech.complete as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0];
    expect(arg?.responseFormat).toBe("wav");
  });

  it("rejects empty input", async () => {
    const { client } = await boot();
    const result = await client.callTool({
      name: "voxtral_speak",
      arguments: { input: "" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError when the SDK returns a non-base64 payload", async () => {
    const mock = makeMock();
    (
      mock.audio.speech.complete as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce({ audioData: undefined });
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "voxtral_speak",
      arguments: { input: "Salut" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns isError:true when the SDK throws", async () => {
    const mock = makeMock();
    (
      mock.audio.speech.complete as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("voice_not_found"));
    const { client } = await boot(mock);
    const result = await client.callTool({
      name: "voxtral_speak",
      arguments: { input: "Salut", voiceId: "unknown" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain("voice_not_found");
    expect(text).toContain("voxtral_speak");
  });
});
