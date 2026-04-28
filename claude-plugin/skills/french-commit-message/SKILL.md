---
description: Génère un message de commit git en français au format Conventional Commits à partir des changements stagés. Récupère automatiquement le diff via git diff --staged. À utiliser quand l'utilisateur demande un commit message, message de commit, ou résumé de diff en français.
---

# Message de commit (FR, Conventional Commits)

Tu génères un message de commit Conventional Commits propre en français à partir du diff git.

## Workflow

### Étape 1 — Récupérer le diff

Sauf si l'utilisateur fournit un diff dans `$ARGUMENTS`, exécute :

```bash
git diff --staged
```

Si le résultat est vide :
1. Vérifie s'il y a des changements non-stagés : `git status`
2. Demande à l'utilisateur de stage les fichiers (`git add`) ou propose-lui d'inclure les changements unstaged via `git diff` simple.

### Étape 2 — Détecter le scope Conventional Commits

Inspecte les fichiers touchés et déduis le type :

| Patterns de fichiers | Type probable |
|---|---|
| `*.test.*`, `**/__tests__/**`, `test/**` | `test` |
| `README*`, `*.md`, `docs/**` | `docs` |
| `package.json`, `package-lock.json`, `Dockerfile`, `.github/**` | `chore` |
| `**/bench*`, perf-related code | `perf` |
| Refactor sans nouvelle feature ni fix (regarde le diff) | `refactor` |
| Bug visible dans le diff (correction d'erreur, edge case) | `fix` |
| Tout le reste | `feat` |

Si plusieurs types s'appliquent, choisis le **dominant** (le changement principal). Demande à l'utilisateur en cas d'ambiguïté forte.

### Étape 3 — Générer le message

Appelle le prompt MCP `french_commit_message` exposé par le serveur `mistral` :
- `diff` : le diff récupéré à l'étape 1
- `scope` : le type détecté à l'étape 2

Utilise `mistral_chat` avec :
- `model` : `codestral-latest` (spécialisé code, comprend bien les diffs)
- `temperature` : `0.3` (peu de variabilité, on veut du déterministe)

## Format de sortie

```
<type>(<portée>): <sujet 72 char max, impératif présent>

<corps optionnel : pourquoi, pas quoi>
```

Règles :
- Sujet en impératif présent, **sans point final**
- Pas d'émoji, pas de majuscule au début du sujet
- Corps uniquement si le « pourquoi » n'est pas trivial

## Exemples

- `/mistral-mcp:french-commit-message` → utilise `git diff --staged`
- `/mistral-mcp:french-commit-message <diff>` → utilise le diff fourni
