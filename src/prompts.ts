/**
 * v0.3 Prompts primitive — curated templates for common Mistral-friendly workflows.
 *
 * MCP spec 2025-11-25: Prompts are templated messages/workflows for users.
 * These are high-signal starters that a client (e.g. Claude Desktop) surfaces
 * in its prompt picker and hydrates with args.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerMistralPrompts(server: McpServer) {
  // ========== french_invoice_reminder ==========
  server.registerPrompt(
    "french_invoice_reminder",
    {
      title: "French B2B invoice reminder",
      description:
        "Draft a tone-controlled B2B invoice recovery reminder in French. " +
        "Returns a system + user pair ready to feed into mistral_chat.",
      argsSchema: {
        debtor_name: z.string().describe("Company name of the debtor."),
        amount_eur: z
          .string()
          .describe("Amount due, formatted as a string e.g. '1200'."),
        days_overdue: z
          .string()
          .describe("Number of days the invoice is overdue, as a string."),
        tone: z
          .enum(["polite", "firm", "final"])
          .describe("Tone: polite | firm | final."),
      },
    },
    ({ debtor_name, amount_eur, days_overdue, tone }) => ({
      description: `Invoice reminder — ${tone} tone, ${debtor_name}, ${amount_eur}€, ${days_overdue}d overdue`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Tu rédiges une relance de facture B2B en français.",
              "Contraintes strictes :",
              "- 120 mots maximum",
              "- Ton demandé : " + tone,
              "- Mentionne le nom du débiteur, le montant et l'échéance dépassée",
              "- Termine par une proposition d'action concrète (contact, plan)",
              "- Pas de formule automatique du type « Cordialement, L'équipe »",
              "",
              `Débiteur : ${debtor_name}`,
              `Montant dû : ${amount_eur}€`,
              `Retard : ${days_overdue} jours`,
              `Ton : ${tone}`,
              "",
              "Rédige la relance complète, prête à envoyer.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ========== codestral_review ==========
  server.registerPrompt(
    "codestral_review",
    {
      title: "Codestral code review",
      description:
        "Review a diff through Codestral with a focused lens " +
        "(correctness, perf, security, or API-design). Returns messages for mistral_chat.",
      argsSchema: {
        diff: z.string().describe("Unified diff text to review."),
        focus: z
          .enum(["correctness", "performance", "security", "api_design"])
          .describe("Review lens."),
      },
    },
    ({ diff, focus }) => ({
      description: `Codestral review — focus: ${focus}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "You are a senior code reviewer. Critique the following diff through the lens of: " +
                focus +
                ".",
              "",
              "Rules:",
              "- Be concrete: cite exact lines or token ranges from the diff.",
              "- Flag real risks only. Don't invent issues.",
              "- Prefer 3 high-signal findings over 10 shallow ones.",
              "- End with a verdict: ship / change-requested / block.",
              "",
              "Diff:",
              "```diff",
              diff,
              "```",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
