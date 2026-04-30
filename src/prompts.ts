/**
 * Prompts primitive — curated FR/EN templates for common Mistral workflows.
 *
 * MCP spec 2025-11-25: Prompts are templated messages/workflows surfaced to
 * the user (e.g. in Claude Desktop's prompt picker). Enum arguments are
 * wrapped with `completable()` so clients can offer argument autocomplete
 * (completion/complete request, spec 2025-03-26+).
 *
 * Language policy: FR canonical, EN optional. No other languages.
 *
 * Prompt engineering: long data inputs are placed BEFORE instructions
 * (Anthropic guideline: ~30 % quality gain). XML tags wrap document content
 * for unambiguous separation from instructions.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { z } from "zod";

const TONE_INVOICE = ["polite", "firm", "final"] as const;
const FOCUS_REVIEW = [
  "correctness",
  "performance",
  "security",
  "api_design",
] as const;
const LENGTH_MINUTES = ["courte", "moyenne", "detaillee"] as const;
const INTENT_EMAIL = [
  "accepter",
  "refuser",
  "repousser",
  "demander_info",
  "proposer",
] as const;
const TONE_EMAIL = ["cordial", "formel", "chaleureux", "direct"] as const;
const SCOPE_COMMIT = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "test",
  "chore",
  "perf",
] as const;
const AUDIENCE_LEGAL = ["juriste", "dirigeant", "grand_public"] as const;

function startsWithFilter<T extends string>(
  options: readonly T[],
  value: string | undefined
): T[] {
  const q = (value ?? "").toLowerCase();
  return options.filter((o) => o.toLowerCase().startsWith(q));
}

export function registerMistralPrompts(server: McpServer) {
  // ========== french_invoice_reminder ==========
  server.registerPrompt(
    "french_invoice_reminder",
    {
      title: "Relance de facture B2B (FR)",
      description:
        "Rédige une relance de facture B2B en français avec un ton contrôlé. " +
        "Retourne une paire de messages (assistant + user) prête à passer dans mistral_chat.",
      argsSchema: {
        debtor_name: z.string().describe("Raison sociale du débiteur."),
        amount_eur: z
          .string()
          .describe("Montant dû, formaté en chaîne, ex. '1200'."),
        days_overdue: z
          .string()
          .describe("Nombre de jours de retard, en chaîne."),
        tone: completable(
          z.enum(TONE_INVOICE).describe("Ton : polite | firm | final."),
          (value) => startsWithFilter(TONE_INVOICE, value)
        ),
      },
    },
    ({ debtor_name, amount_eur, days_overdue, tone }) => ({
      description: `Relance — ton ${tone}, ${debtor_name}, ${amount_eur}€, ${days_overdue}j de retard`,
      messages: [
        {
          role: "assistant",
          content: {
            type: "text",
            text: [
              "Tu es un assistant de recouvrement B2B.",
              "Tu rédiges des relances courtes, claires, professionnelles, directement envoyables.",
              "Tu respectes strictement les contraintes de ton, de longueur et de clarté.",
            ].join("\n"),
          },
        },
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Rédige une relance de facture B2B en français.",
              "Contraintes strictes :",
              "- 120 mots maximum",
              "- Ton demandé : " + tone,
              "- Mentionne le nom du débiteur, le montant et l'échéance dépassée",
              "- Termine par une proposition d'action concrète (contact, plan)",
              "- Pas de formule automatique du type « Cordialement, L'équipe »",
              "",
              "<contexte>",
              `Débiteur : ${debtor_name}`,
              `Montant dû : ${amount_eur}€`,
              `Retard : ${days_overdue} jours`,
              `Ton : ${tone}`,
              "</contexte>",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ========== french_meeting_minutes ==========
  server.registerPrompt(
    "french_meeting_minutes",
    {
      title: "Compte-rendu de réunion (FR)",
      description:
        "Transforme une transcription brute en compte-rendu structuré en français. " +
        "Retourne un message utilisateur prêt à passer dans mistral_chat ou voxtral_transcribe→mistral_chat.",
      argsSchema: {
        transcript: z
          .string()
          .describe("Transcription brute de la réunion (texte libre)."),
        length: completable(
          z
            .enum(LENGTH_MINUTES)
            .describe("Longueur : courte | moyenne | detaillee."),
          (value) => startsWithFilter(LENGTH_MINUTES, value)
        ),
      },
    },
    ({ transcript, length }) => ({
      description: `Compte-rendu de réunion — longueur ${length}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "<transcript>",
              transcript,
              "</transcript>",
              "",
              "Rédige un compte-rendu de réunion structuré en français à partir de la transcription ci-dessus.",
              `Longueur cible : ${length}.`,
              "",
              "Structure obligatoire :",
              "1. **Contexte** — 1 à 2 phrases.",
              "2. **Participants** — liste s'ils sont identifiables, sinon « non spécifiés ».",
              "3. **Décisions prises** — puces concises, une décision par puce.",
              "4. **Actions à mener** — puces au format « [Responsable] Action — échéance ».",
              "5. **Points ouverts** — puces des questions non tranchées.",
              "",
              "Règles :",
              "- Reste factuel. Appuie-toi uniquement sur le contenu de la transcription.",
              "- Si une information manque, écris explicitement « non précisé ».",
              "- Pas de paraphrase moralisatrice, pas de « il est important de ».",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ========== french_email_reply ==========
  server.registerPrompt(
    "french_email_reply",
    {
      title: "Réponse e-mail professionnel (FR)",
      description:
        "Rédige une réponse à un e-mail professionnel en français, avec intention et ton contrôlés. " +
        "Retourne un message utilisateur prêt à passer dans mistral_chat.",
      argsSchema: {
        original_email: z
          .string()
          .describe("E-mail reçu auquel il faut répondre (texte brut)."),
        intent: completable(
          z
            .enum(INTENT_EMAIL)
            .describe(
              "Intention : accepter | refuser | repousser | demander_info | proposer."
            ),
          (value) => startsWithFilter(INTENT_EMAIL, value)
        ),
        tone: completable(
          z
            .enum(TONE_EMAIL)
            .describe("Ton : cordial | formel | chaleureux | direct."),
          (value) => startsWithFilter(TONE_EMAIL, value)
        ),
      },
    },
    ({ original_email, intent, tone }) => ({
      description: `Réponse e-mail — intent ${intent}, ton ${tone}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "<email_recu>",
              original_email,
              "</email_recu>",
              "",
              "Rédige une réponse à cet e-mail, en français.",
              `Intention : ${intent}.`,
              `Ton : ${tone}.`,
              "",
              "Contraintes :",
              "- 150 mots maximum",
              "- Reprends explicitement le point principal du message reçu",
              "- Termine par une phrase actionnable (date, décision, prochaine étape)",
              "- Formule de politesse directe, sans rhétorique convenue",
              "- Pas de signature, l'expéditeur la rajoutera",
              "",
              "Rédige uniquement le corps de la réponse.",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ========== french_commit_message ==========
  server.registerPrompt(
    "french_commit_message",
    {
      title: "Message de commit (FR, Conventional Commits)",
      description:
        "Rédige un message de commit git en français au format Conventional Commits à partir d'un diff. " +
        "Retourne un message utilisateur prêt à passer dans mistral_chat ou codestral_fim.",
      argsSchema: {
        diff: z.string().describe("Diff unifié à résumer en commit."),
        scope: completable(
          z
            .enum(SCOPE_COMMIT)
            .describe(
              "Type Conventional Commits : feat | fix | refactor | docs | test | chore | perf."
            ),
          (value) => startsWithFilter(SCOPE_COMMIT, value)
        ),
      },
    },
    ({ diff, scope }) => ({
      description: `Commit message — type ${scope}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "```diff",
              diff,
              "```",
              "",
              "Rédige un message de commit git en français pour le diff ci-dessus.",
              `Type Conventional Commits : ${scope}.`,
              "",
              "Format exact :",
              "```",
              `${scope}(<portee>): <sujet de 72 caracteres max, imperatif present>`,
              "",
              "<corps optionnel : pourquoi ce changement, pas ce qu'il fait>",
              "```",
              "",
              "Règles :",
              "- Sujet en impératif présent, sans point final",
              "- Si le diff touche plusieurs fichiers liés, garde un seul sujet cohérent",
              "- Corps uniquement si le « pourquoi » n'est pas trivial",
              "- Pas d'émoji, pas de majuscule au début du sujet",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ========== french_legal_summary ==========
  server.registerPrompt(
    "french_legal_summary",
    {
      title: "Synthèse juridique (FR)",
      description:
        "Résume un texte juridique (CGU, contrat, arrêté, décision) en français, ciblé sur une audience. " +
        "Retourne un message utilisateur prêt à passer dans mistral_chat. Ne constitue pas un conseil juridique.",
      argsSchema: {
        legal_text: z.string().describe("Texte juridique brut à résumer."),
        audience: completable(
          z
            .enum(AUDIENCE_LEGAL)
            .describe("Audience cible : juriste | dirigeant | grand_public."),
          (value) => startsWithFilter(AUDIENCE_LEGAL, value)
        ),
      },
    },
    ({ legal_text, audience }) => ({
      description: `Synthèse juridique — audience ${audience}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "<document>",
              legal_text,
              "</document>",
              "",
              "Résume le texte juridique ci-dessus en français.",
              `Audience cible : ${audience}.`,
              "",
              "Structure obligatoire :",
              "1. **Nature du document** — 1 phrase (type, parties, date si présente).",
              "2. **Obligations principales** — 3 à 5 puces.",
              "3. **Droits principaux** — 3 à 5 puces.",
              "4. **Points de vigilance** — clauses à fort impact, pénalités, résiliation, renouvellement tacite.",
              "5. **Ce que le document NE dit PAS** — zones grises explicites.",
              "",
              "Règles :",
              "- Adapte le niveau de vocabulaire à l'audience (jargon accepté pour « juriste », vulgarisation pour « grand_public »).",
              "- Base chaque information strictement sur le texte source fourni.",
              "- Termine par : « Ceci est une synthèse informative, pas un conseil juridique. »",
            ].join("\n"),
          },
        },
      ],
    })
  );

  // ========== codestral_review (EN) ==========
  server.registerPrompt(
    "codestral_review",
    {
      title: "Codestral code review",
      description:
        "Review a diff through Codestral with a focused lens " +
        "(correctness, perf, security, or API-design). Returns messages for mistral_chat.",
      argsSchema: {
        diff: z.string().describe("Unified diff text to review."),
        focus: completable(
          z
            .enum(FOCUS_REVIEW)
            .describe(
              "Review lens: correctness | performance | security | api_design."
            ),
          (value) => startsWithFilter(FOCUS_REVIEW, value)
        ),
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
              "```diff",
              diff,
              "```",
              "",
              "You are a senior code reviewer. Critique the diff above through the lens of: " +
                focus +
                ".",
              "",
              "Rules:",
              "- Be concrete: cite exact lines or token ranges from the diff.",
              "- Flag only risks that are explicitly present in the diff.",
              "- Prefer 3 high-signal findings over 10 shallow ones.",
              "- End with a verdict: ship / change-requested / block.",
            ].join("\n"),
          },
        },
      ],
    })
  );
}
