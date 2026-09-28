---
name: french-invoice-reminder
description: Rédige un brouillon de relance de facture B2B en français, avec un ton poli, ferme ou final, à partir des informations de paiement fournies.
---

# Relance de facture B2B

Utilise le prompt MCP `french_invoice_reminder`, puis `mistral_chat`, disponible dans `core`, `metier-docs`, `admin` et sur un endpoint compatible avec `self-hosted`.

Récupère les arguments du prompt dans le contexte fourni :

| Argument | Valeur attendue |
|---|---|
| `debtor_name` | Nom du débiteur, chaîne |
| `amount_eur` | Montant restant dû en euros, chaîne |
| `days_overdue` | Nombre de jours de retard, chaîne |
| `tone` | `polite`, `firm` ou `final` |

Respecte le ton demandé ; à défaut, utilise `polite`. Demande seulement les informations manquantes. Un total de facture ne prouve ni le solde impayé ni le retard. Si la source est un document, le skill `pdf-invoice-extractor` peut extraire ses champs disponibles, mais le débiteur, les paiements déjà reçus et le retard doivent être établis séparément. Ne convertis pas implicitement une autre devise en euros.

Récupère le prompt `french_invoice_reminder` avec les quatre arguments. Convertis chaque message texte retourné en `{role, content: message.content.text}` avant de fournir `messages` à `mistral_chat`. Omet `model` pour respecter le modèle configuré ; `temperature: 0.6` et `max_tokens: 400` sont des options valides.

Vérifie `isError`, puis lis `structuredContent.text`. Contrôle que le texte reste sous 120 mots, respecte le ton, mentionne le débiteur, le montant et le retard, et propose une action concrète. N'ajoute ni pénalité, ni menace de procédure, ni engagement absent du contexte. Termine sans formule automatique « Cordialement, L'équipe ».

Affiche le brouillon prêt à copier. L'envoi d'un message nécessite une demande explicite de l'utilisateur.
