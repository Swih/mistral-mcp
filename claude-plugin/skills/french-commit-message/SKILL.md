---
name: french-commit-message
description: Rédige un message Conventional Commits en français à partir d'un diff fourni ou des changements Git indexés. À utiliser pour une demande de message de commit ou de résumé de diff en français.
---

# Message de commit en français

Utilise le prompt MCP `french_commit_message`, puis `mistral_chat`. Le chat est disponible dans `core`, `metier-docs`, `admin` et sur un endpoint compatible avec `self-hosted`. Vérifie `mistral://capabilities` si nécessaire.

1. Utilise le diff fourni ou exécute `git diff --staged`. Si l'index est vide, consulte `git diff` et précise que le message proposé décrit des changements non indexés. S'il n'y a aucun diff, demande la plage à résumer.
2. Choisis le type selon le changement principal : `feat`, `fix`, `refactor`, `docs`, `test`, `chore` ou `perf`. Ne déduis pas une fonctionnalité du seul nom d'un fichier.
3. Récupère le prompt `french_commit_message` avec `diff` et `scope`. Malgré son nom, `scope` attend le **type** ci-dessus, pas le nom d'un module.
4. Convertis chaque message texte du prompt en `{role, content: message.content.text}`, puis appelle `mistral_chat` avec `messages`. Omet `model` pour respecter le modèle configuré. `temperature: 0.3` est facultatif et ne garantit pas une sortie déterministe.
5. Vérifie `isError`, puis lis `structuredContent.text` et confronte le message au diff.

Rends un message prêt à copier :

```text
<type>(<portée>): <sujet français à l'impératif, 72 caractères maximum>

<corps facultatif expliquant la raison du changement>
```

Le sujet commence par une minuscule, sans émoji ni point final. N'invente pas de motivation ni de tests exécutés. Cette demande produit un message ; elle n'autorise pas à indexer des fichiers, créer un commit ou pousser une branche.
