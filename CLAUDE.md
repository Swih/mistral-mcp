# CLAUDE.md — mistral-mcp

> Instructions de travail pour Claude (Opus 4.7) sur ce repo.
> Objectif : un serveur MCP centré sur les documents, avec un profil `core` de six outils et une couverture avancée explicite. La compatibilité est testée ; la disponibilité de l'API Mistral n'est pas garantie par ce dépôt.

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour les validations et [MIGRATION.md](MIGRATION.md) pour la version candidate 1.0.0-rc.1.

---

## 1. Identité du projet

- **Nom** : `mistral-mcp` (npm + github.com/Swih/mistral-mcp)
- **Rôle** : serveur MCP stdio + Streamable HTTP wrappant l'API Mistral pour clients MCP (Claude Code, Cursor, Zed, Windsurf, Claude Desktop, ChatGPT Apps).
- **Versions en vigueur** :
  - MCP spec : **2026-07-28**, **plus** le handshake 2025 servi depuis les mêmes
    enregistrements. Le second n'est pas de la dette : c'est ce que parlent
    quasiment tous les clients diffusés. Toute évolution doit rester servable
    aux deux ères — `test/stdio/protocol-eras.test.ts` le vérifie.
  - SDK MCP : `@modelcontextprotocol/server@^2.0.0` — **toujours** via la high-level API `McpServer` + `registerTool/Resource/Prompt`. Ne jamais descendre au low-level `Server`.
    - stdio et HTTP prennent une **factory**, jamais une instance : `serveStdio(factory, { legacy: "serve" })` et `createMcpHandler(factory, { legacy: "stateless" })`. C'est le SDK qui décide de l'ère.
    - `@modelcontextprotocol/sdk@^1.30.0` reste en devDependency : c'est le client de l'ère 2025 utilisé pour tester la compat, rien d'autre ne doit l'importer.
  - SDK Mistral : `@mistralai/mistralai@^2.6.4` (Speakeasy-generated). Retry config obligatoire.
  - zod : `^4.2.0` (plancher imposé par le SDK v2). Attention : `.default()` porte sur le type de **sortie** en zod 4 — pour un objet dont les champs ont leurs propres defaults, c'est `.prefault({})`.
  - Node : `>=20`, TypeScript strict.

## 2. Règles dures (ne pas transgresser)

1. **Zéro claim non-vérifiable.** Si une feature n'est pas shippée dans ce repo et testée, elle n'existe pas dans le README, la doc, le CHANGELOG. Pas de "coming soon", pas de roadmap aspirationnelle vendue comme acquise.
2. **Langues : FR + EN uniquement.** Prompts, docs, commentaires, messages d'erreur. Aucune autre langue. Si on trouve de l'espagnol/allemand/etc. dans le code, on strippe.
3. **Spec-compliance >>> ergonomie.** Si la spec MCP dit "include `outputSchema`" ou "annotations are REQUIRED for read/write hints", on fait. Toujours.
4. **Chaque tool renvoie `content[]` ET `structuredContent`.** `content[]` = fallback lisible pour clients pré-2025-06-18. `structuredContent` = payload JSON strict conforme à `outputSchema`. Jamais l'un sans l'autre.
5. **Chaque tool déclare `annotations`** : `title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`. Pour un wrapper API externe, `openWorldHint=true` quasi toujours.
6. **Erreurs API → `{ content: [text], isError: true }`**, jamais `throw`. Le LLM appelant doit pouvoir self-correct.
7. **Les inputs zod sont la source de vérité.** Jamais de cast `as any`, jamais de `z.any()`. Si un type Mistral n'est pas exporté, on le reconstruit avec zod, on ne "fait confiance".
8. **Le retry config est non-négociable** : `backoff` strategy, `initialInterval: 500`, `maxInterval: 5000`, `exponent: 2`, `maxElapsedTime: 30000`, `retryConnectionErrors: true`, `timeoutMs: 60000`.
9. **Pas d'env var autre que `MISTRAL_API_KEY`** sans justification. L'API key est lue UNE fois dans `src/index.ts`.
10. **Pas de dépendance runtime ajoutée** sans approbation explicite. Les seules deps runtime acceptées : `@modelcontextprotocol/server`, `@mistralai/mistralai`, `zod`. Point final. C'est pourquoi l'adaptateur `node:http` ↔ web-standard est écrit à la main dans `transport.ts` plutôt que pris chez `@modelcontextprotocol/node`, qui traîne `@hono/node-server` pour quarante lignes.

## 3. Layout & responsabilités

```
src/
├── index.ts            # Entry point stdio. Bootstrap Mistral SDK + McpServer. Wiring uniquement.
├── models.ts           # Allow-lists Mistral (chat/embed/fim/tool/vision/audio/ocr). Zod enums. DEFAULT_*.
├── tools.ts            # Core chat/embed : mistral_chat (multimodal inclus), mistral_chat_stream, mistral_embed
├── tools-fn.ts         # Function calling + FIM : mistral_tool_call, codestral_fim
├── tools-vision.ts     # (v0.4) OCR : mistral_ocr
├── tools-audio.ts      # (v0.4) Voxtral : voxtral_transcribe, voxtral_speak
├── tools-agents.ts     # (v0.4) Agents + moderation : mistral_agent, mistral_moderate, mistral_classify
├── tools-files.ts      # (v0.4) Files API : files_upload/list/get/delete/signed_url
├── tools-batch.ts      # (v0.4) Batch API : batch_create/get/cancel/download
├── resources.ts        # mistral://capabilities, mistral://models (LIVE GET /v1/models), voices, workflows
├── prompts.ts          # Prompts curés FR (5+) + EN (optionnel)
├── transport.ts        # serveStdio + createMcpHandler (double ère) + adaptateur node:http maison.
└── shared.ts           # toTextBlock, errorResult, schemas communs (MessageSchema, UsageSchema, ImageContentSchema, ...)

test/
├── unit/               # vitest + InMemoryTransport + mocked SDK
├── stdio/              # spawn dist/index.js : protocole, deux ères, HTTP, endpoint self-hosted
├── live/               # MISTRAL_API_KEY requis, skipIf sinon
├── fixtures/           # corpus d'ingestion synthétique + corpus.json (vérité terrain)
└── contract/           # Vérifie structuredContent === outputSchema pour chaque tool
```

## 4. Conventions de code

### Handler de tool (pattern canonique)

```ts
server.registerTool(
  "tool_name",
  {
    title: "...",
    description: "Quand l'utiliser / contraintes / format de retour. Pas de marketing.",
    inputSchema: { /* zod */ },
    outputSchema: { /* zod, payload strict */ },
    annotations: { title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint },
  },
  async (input, extra) => {
    try {
      const res = await mistral.X.Y(input);
      const structured = mapToOutputSchema(res);
      return {
        content: [toTextBlock(summary(structured))],
        structuredContent: structured,
      };
    } catch (err) {
      return errorResult("tool_name", err);
    }
  }
);
```

### Règles zod
- Schemas composables dans `shared.ts` (ex: `MessageSchema`, `UsageSchema`, `ImageContentSchema`).
- Toujours `.describe()` sur les champs utilisateur — Claude et les autres LLMs lisent ces descriptions.
- Pas de `z.any()`. Si besoin de "inconnu mais JSON-able" → `z.unknown()` avec `.transform()`.
- Enums = `as const` array + `z.enum([...arr])`.

### Imports
- Side-effect-free. Jamais de code qui tourne à l'import (connexion SDK = dans `index.ts` uniquement).
- Named exports partout. Jamais de `export default`.

### Commentaires
- Un commentaire = une raison WHY non-évidente. Jamais WHAT.
- Les liens vers la spec MCP ou la doc Mistral sont OK en tête de module.
- Aucun commentaire de changelog inline ("added in v0.4", "was removed"). → va dans CHANGELOG.md.

## 5. Commandes essentielles

```bash
npm run build        # tsc → dist/
npm run dev          # tsx watch
npm run lint         # tsc --noEmit (pas d'ESLint pour l'instant, keep it minimal)
npm test             # vitest run (tout)
npm run test:unit    # unit/ seulement
npm run test:stdio   # stdio/ seulement
npm run test:live    # live/ — requiert MISTRAL_API_KEY
npm run inspector    # MCP Inspector UI sur dist/index.js

npm run fixtures:generate  # régénère test/fixtures/corpus/ (pas de clé requise)
npm run eval:docs          # score le corpus contre l'OCR réel + calibre minOcrConfidence
```

## 6. Pyramide de tests

| Niveau | Emplacement | Runtime | Quoi | Quand |
|---|---|---|---|---|
| 1. Unit | `test/unit/` | mock SDK | Handlers, schemas, helpers | Chaque PR, toujours |
| 2. Contract | `test/contract/` | InMemoryTransport | `structuredContent` valide contre `outputSchema` pour **chaque** tool | Chaque PR |
| 3. Stdio e2e | `test/stdio/` | spawn `dist/index.js` | Handshake, list_tools, un call réel par catégorie | Pre-release |
| 4. Live API | `test/live/` | real Mistral | Une requête par endpoint wrappé, payload vérifié | Manuel + CI cron |
| 5. Smoke | `examples/` | end-user scripts | `try-it.mjs` passe | Pre-release |

Règle : **un test qui `skipIf` en CI ne compte pas comme un test**. Un niveau de la
pyramide qui ne peut pas tourner sans secret doit soit avoir un sous-ensemble qui
tourne sans secret (cas de `test/stdio/`), soit échouer bruyamment quand le secret
manque (cas de `live.yml`). Un job vert qui n'exécute rien est pire que pas de job.

Règle : **un tool non testé ne ship pas**. Si on ajoute `mistral_ocr`, on ajoute au minimum : 1 unit + 1 contract + 1 live (skipIf no key).

## 7. Process de release

1. Branch `v0.X-dev` pour le travail multi-phase. Merge dans `main` uniquement quand **tous** les tests passent et la doc est à jour.
2. Bump `package.json` SemVer :
   - `patch` : fix sans nouveau tool/resource/prompt
   - `minor` : nouveau tool/resource/prompt sans breaking
   - `major` : rename/removal de tool, changement de signature
3. `CHANGELOG.md` — format Keep-a-Changelog, sections `Added / Changed / Fixed / Removed / Security`.
4. `npm publish` (2FA required — `npm token create --2fa` si CI).
5. `gh release create v0.X.Y --notes-file CHANGELOG-v0.X.Y.md`.
6. Update `README.md` badge versions + downloads count.

## 8. Anti-patterns (ne jamais faire)

| Ne fais pas | Fais plutôt |
|---|---|
| `z.any()` ou `as any` | Zod schema strict, reconstruit si besoin |
| `console.log` | `console.error` (stdout réservé à JSON-RPC) |
| `throw` dans un handler | Retour `{ isError: true, content: [text] }` |
| Liste figée de modèles | Appel live `GET /v1/models` |
| Feature flag inutile | Supprime le code mort |
| Prompt en italien/allemand/etc. | FR ou EN uniquement |
| `// TODO: refactor later` | Soit fais-le maintenant, soit ouvre une issue |
| Dépendance runtime ajoutée | Inline / reconstruit / on s'en passe |
| Commentaire expliquant QUOI fait le code | Le nom de variable suffit |
| Mock dans test live | Les tests live frappent l'API réelle, sinon ils sont `unit` |
| Seuil/constante « empirique » non mesurée | Soit tu la mesures (`npm run eval:docs`), soit tu la dis non mesurée |
| PII réelle dans `test/fixtures/` | Tout le corpus est inventé et doit rester publiable |

## 9. Signal de qualité (à viser pour v0.4)

- [ ] 100 % des tools ont `outputSchema` + `annotations` complètes.
- [ ] 100 % des tools ont un test `contract` qui valide `structuredContent` contre `outputSchema`.
- [ ] Couverture Mistral API ≥ 85 % (chat, embed, fim, ocr, audio, files, batch, agents, moderations, classifications, models).
- [ ] Transports : stdio + Streamable HTTP fonctionnels, testés.
- [ ] README bilingue (EN canonique, FR en miroir).
- [ ] CI GitHub Actions verte (Node 20 + 22).
- [ ] Changelog v0.4 signé et release GitHub publiée.
- [ ] `npm audit` clean (pas de vuln high/critical).

## 10. Sécurité

- `MISTRAL_API_KEY` est la seule secret. Lue dans `process.env`, jamais loggée.
- Pas de fichier `.env` commité. `.env.example` à jour.
- Les logs d'erreur ne contiennent jamais le payload utilisateur complet (PII côté client).
- Pour le transport HTTP (v0.4), bearer token simple, pas de stockage, validation stricte de l'origin.

## 11. Quand en douter

- **Spec flou ?** Source racine : <https://modelcontextprotocol.io/specification/2026-07-28/>. Le changelog de révision dit ce qui a bougé depuis 2025-11-25.
- **API Mistral flou ?** Source racine : <https://docs.mistral.ai/api/>. Endpoints actifs uniquement (skip deprecated fine-tuning v1, legacy agents).
- **SDK Mistral flou ?** Source : <https://github.com/mistralai/client-ts>.
- **Pattern MCP flou ?** Référence : <https://github.com/modelcontextprotocol/servers/tree/main/src/everything> (serveur officiel démo qui exerce toutes les primitives).

---

*Mis à jour : v0.10.1 (MCP 2026-07-28 + SDK v2). Lire en entier avant de toucher au code.*
