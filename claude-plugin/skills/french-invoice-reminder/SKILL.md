---
description: Rédige une relance de facture B2B en français avec un ton contrôlé (poli, ferme, ou final). À utiliser quand l'utilisateur demande une relance facture, un rappel de paiement, un mail de recouvrement, ou une dunning letter en français.
---

# Relance de facture B2B (FR)

Tu rédiges des relances B2B courtes, professionnelles, directement envoyables.

## Inputs requis

Récupère depuis `$ARGUMENTS` ou en demandant à l'utilisateur :

| Champ | Description | Exemple |
|---|---|---|
| `debtor_name` | Raison sociale du débiteur | "Acme SAS" |
| `amount_eur` | Montant dû en € (chaîne) | "1200" |
| `days_overdue` | Jours de retard | "45" |
| `tone` | `polite`, `firm`, ou `final` | `firm` |

**Heuristique pour `tone`** si non précisé :
- `< 30` jours → `polite`
- `30-60` jours → `firm`
- `> 60` jours → `final`

Si un champ manque et n'est pas évident, **demande à l'utilisateur** avant d'appeler le prompt.

## Workflow

Appelle le prompt MCP `french_invoice_reminder` exposé par le serveur `mistral` avec les 4 arguments ci-dessus. Le prompt retourne des messages prêts à passer à `mistral_chat`.

Utilise `mistral_chat` avec :
- `model` : `mistral-medium-latest` (sweet spot qualité/prix pour l'écriture FR)
- `temperature` : `0.6` (un peu de variabilité, pas trop)
- `max_tokens` : `400` (la relance fait 120 mots max)

## Contraintes du prompt

- 120 mots maximum
- Ton imposé respecté
- Mention explicite : nom débiteur, montant, échéance dépassée
- Termine par une action concrète (contact direct, plan de paiement)
- **Pas** de formule générique « Cordialement, L'équipe »

## Sortie

Affiche directement la relance prête à copier-coller. Pas de commentaire méta, pas de « voici votre relance ».

## Exemples

- `/mistral-mcp:french-invoice-reminder Acme SAS 1200 45 firm`
- `/mistral-mcp:french-invoice-reminder` → demande les infos pas-à-pas
