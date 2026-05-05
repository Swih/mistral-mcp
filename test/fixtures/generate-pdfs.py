"""Generate 4 realistic synthetic PDFs for process_document live testing.

Outputs (in test/fixtures/):
- contract.pdf       — service agreement (legal vocabulary, multi-clause)
- invoice.pdf        — French invoice with VAT, line items, anomaly
- id_card.pdf        — synthetic ID card (NOT a real document)
- meeting_notes.pdf  — generic meeting notes (the "generic" baseline)

All content is SYNTHETIC and made up for testing. No real PII.
"""
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors

OUT = Path(__file__).parent
OUT.mkdir(parents=True, exist_ok=True)

styles = getSampleStyleSheet()
h = styles["Heading1"]
h2 = styles["Heading2"]
body = styles["BodyText"]
small = ParagraphStyle("small", parent=body, fontSize=9, leading=11)


def build_contract():
    doc = SimpleDocTemplate(str(OUT / "contract.pdf"), pagesize=A4)
    story = [
        Paragraph("CONTRAT DE PRESTATION DE SERVICES", h),
        Spacer(1, 0.5 * cm),
        Paragraph(
            "Entre les soussign&#233;s :<br/>"
            "<b>ACME SAS</b>, soci&#233;t&#233; au capital de 50&#160;000&#8364;, dont le si&#232;ge social est "
            "situ&#233; 12 rue de la Paix, 75002 Paris, immatricul&#233;e au RCS de Paris sous "
            "le num&#233;ro 845 327 109, repr&#233;sent&#233;e par M. Jean Dupont, Pr&#233;sident, "
            "ci-apr&#232;s d&#233;sign&#233;e &#171;&#160;le Prestataire&#160;&#187;,",
            body,
        ),
        Spacer(1, 0.3 * cm),
        Paragraph(
            "et<br/>"
            "<b>BetaCorp SARL</b>, soci&#233;t&#233; au capital de 20&#160;000&#8364;, dont le si&#232;ge "
            "social est situ&#233; 5 avenue des Champs, 69002 Lyon, repr&#233;sent&#233;e par "
            "Mme Sophie Martin, G&#233;rante, ci-apr&#232;s d&#233;sign&#233;e &#171;&#160;le Client&#160;&#187;.",
            body,
        ),
        Spacer(1, 0.5 * cm),
        Paragraph("Article 1 — Objet", h2),
        Paragraph(
            "Le Prestataire s&#8217;engage &#224; fournir des prestations de conseil en strat&#233;gie "
            "digitale au Client, telles que d&#233;crites en Annexe A.",
            body,
        ),
        Paragraph("Article 2 — Dur&#233;e", h2),
        Paragraph(
            "Le pr&#233;sent contrat prend effet le 1er juin 2026 pour une dur&#233;e de douze (12) mois, "
            "renouvelable par tacite reconduction sauf d&#233;nonciation par l&#8217;une des parties trois "
            "mois avant l&#8217;&#233;ch&#233;ance.",
            body,
        ),
        Paragraph("Article 3 — R&#233;mun&#233;ration", h2),
        Paragraph(
            "Le Client versera au Prestataire la somme de 8&#160;500&#8364; HT par mois, payable &#224; trente "
            "jours fin de mois sur pr&#233;sentation de facture.",
            body,
        ),
        Paragraph("Article 4 — Confidentialit&#233;", h2),
        Paragraph(
            "Chaque partie s&#8217;engage &#224; ne pas divulguer &#224; des tiers les informations "
            "confidentielles &#233;chang&#233;es pendant la dur&#233;e du contrat et pendant cinq (5) ans "
            "apr&#232;s sa cessation. <b>Toute violation entra&#238;nera des dommages-int&#233;r&#234;ts "
            "forfaitaires de 50&#160;000&#8364;.</b>",
            body,
        ),
        Paragraph("Article 5 — R&#233;siliation", h2),
        Paragraph(
            "En cas de manquement grave, la partie non d&#233;faillante pourra r&#233;silier le contrat "
            "de plein droit apr&#232;s mise en demeure rest&#233;e infructueuse pendant trente (30) jours.",
            body,
        ),
        Paragraph("Article 6 — Loi applicable", h2),
        Paragraph(
            "Le pr&#233;sent contrat est soumis au droit fran&#231;ais. Tout litige sera de la "
            "comp&#233;tence exclusive du Tribunal de Commerce de Paris.",
            body,
        ),
        Spacer(1, 0.6 * cm),
        Paragraph("Fait &#224; Paris, le 15 mai 2026, en deux exemplaires originaux.", body),
    ]
    doc.build(story)


def build_invoice():
    doc = SimpleDocTemplate(str(OUT / "invoice.pdf"), pagesize=A4)
    items = [
        ["Description", "Qt&#233;", "PU HT", "Total HT"],
        ["Audit infrastructure cloud (forfait)", "1", "3 200,00", "3 200,00"],
        ["D&#233;veloppement module facturation (jours)", "8", "850,00", "6 800,00"],
        ["Formation &#233;quipe (1/2 journ&#233;e)", "1", "650,00", "650,00"],
    ]
    table = Table(items, colWidths=[8 * cm, 1.5 * cm, 2.5 * cm, 3 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dddddd")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ]
        )
    )
    story = [
        Paragraph("FACTURE N&#176; 2026-0142", h),
        Spacer(1, 0.3 * cm),
        Paragraph(
            "<b>NovaCloud Solutions SAS</b><br/>"
            "27 boulevard Haussmann, 75009 Paris<br/>"
            "SIRET&#160;: 921 458 037 00012 — TVA&#160;: FR47921458037",
            body,
        ),
        Spacer(1, 0.4 * cm),
        Paragraph(
            "<b>Client&#160;:</b> Globex Industries SARL<br/>"
            "14 rue Saint-Honor&#233;, 75001 Paris<br/>"
            "SIRET&#160;: 410 933 218 00045",
            body,
        ),
        Spacer(1, 0.3 * cm),
        Paragraph("Date de facture&#160;: 30 avril 2026<br/>&#201;ch&#233;ance&#160;: 30 mai 2026", body),
        Spacer(1, 0.4 * cm),
        table,
        Spacer(1, 0.5 * cm),
        Paragraph(
            "Sous-total HT&#160;: <b>10 650,00&#8364;</b><br/>"
            "TVA 20&#37;&#160;: <b>2 130,00&#8364;</b><br/>"
            "<b>Total TTC&#160;: 12 780,00&#8364;</b>",
            body,
        ),
        Spacer(1, 0.4 * cm),
        Paragraph(
            "Conditions de paiement&#160;: virement &#224; 30 jours, sans escompte. "
            "P&#233;nalit&#233;s de retard&#160;: trois fois le taux d&#8217;int&#233;r&#234;t l&#233;gal. "
            "Indemnit&#233; forfaitaire pour frais de recouvrement&#160;: 40&#8364;.",
            small,
        ),
    ]
    doc.build(story)


def build_id_card():
    doc = SimpleDocTemplate(str(OUT / "id_card.pdf"), pagesize=A4)
    story = [
        Paragraph("R&#201;PUBLIQUE FRAN&#199;AISE — CARTE NATIONALE D&#8217;IDENTIT&#201;", h),
        Spacer(1, 0.4 * cm),
        Paragraph(
            "<b>SP&#201;CIMEN — DOCUMENT FICTIF DE TEST</b><br/>"
            "Ce document est synth&#233;tique et ne correspond &#224; aucune personne r&#233;elle.",
            small,
        ),
        Spacer(1, 0.5 * cm),
        Paragraph("Nom&#160;: <b>MARTIN</b>", body),
        Paragraph("Pr&#233;noms&#160;: <b>Camille L&#233;a</b>", body),
        Paragraph("Sexe&#160;: F", body),
        Paragraph("N&#233;e le&#160;: <b>14 mars 1992</b>", body),
        Paragraph("&#192;&#160;: Lyon (69)", body),
        Paragraph("Nationalit&#233;&#160;: Fran&#231;aise", body),
        Spacer(1, 0.3 * cm),
        Paragraph("N&#176; document&#160;: <b>FRA-12-2026-AB1234567</b>", body),
        Paragraph("D&#233;livr&#233;e le&#160;: 12 janvier 2026", body),
        Paragraph("Expire le&#160;: <b>11 janvier 2036</b>", body),
        Paragraph("Autorit&#233;&#160;: Pr&#233;fecture du Rh&#244;ne", body),
        Spacer(1, 0.3 * cm),
        Paragraph(
            "MRZ&#160;:<br/>"
            "<font face='Courier'>IDFRAMARTIN&lt;&lt;CAMILLE&lt;LEA&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</font><br/>"
            "<font face='Courier'>AB1234567&lt;6FRA9203144F3601115&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;06</font>",
            small,
        ),
    ]
    doc.build(story)


def build_meeting_notes():
    doc = SimpleDocTemplate(str(OUT / "meeting_notes.pdf"), pagesize=A4)
    story = [
        Paragraph("Compte-rendu de r&#233;union — Sprint planning #42", h),
        Paragraph("Date&#160;: 28 avril 2026 — Dur&#233;e&#160;: 1h30", body),
        Paragraph("Participants&#160;: A. Bernard, M. Diallo, K. Wei, T. Ricci, S. Garcia", body),
        Spacer(1, 0.4 * cm),
        Paragraph("Ordre du jour", h2),
        Paragraph(
            "1. R&#233;trospective du sprint pr&#233;c&#233;dent<br/>"
            "2. Priorisation backlog&#160;Q2<br/>"
            "3. Roadmap mobile<br/>"
            "4. Divers",
            body,
        ),
        Paragraph("R&#233;trospective", h2),
        Paragraph(
            "Le sprint #41 a livr&#233; 7 stories sur 9 pr&#233;vues. Deux sont reprises&#160;: "
            "auth OAuth (bloqu&#233;e par doc partenaire) et migration Postgres 16 (perf "
            "&#224; revalider). V&#233;locit&#233; moyenne stable &#224; 28 points.",
            body,
        ),
        Paragraph("D&#233;cisions", h2),
        Paragraph(
            "&#8226; Migration Postgres 16 d&#233;cal&#233;e en Q3, jug&#233;e non-bloquante.<br/>"
            "&#8226; OAuth&#160;: spike de 3 jours allou&#233; &#224; K. Wei pour d&#233;bloquer la doc partenaire.<br/>"
            "&#8226; Roadmap mobile valid&#233;e&#160;: lancement beta interne d&#233;but juin.",
            body,
        ),
        Paragraph("Actions", h2),
        Paragraph(
            "&#8226; A. Bernard&#160;: pr&#233;parer la roadmap mobile pour le comit&#233; produit (5 mai).<br/>"
            "&#8226; M. Diallo&#160;: r&#233;diger l&#8217;ADR sur la d&#233;cision Postgres.<br/>"
            "&#8226; T. Ricci&#160;: relancer le partenaire OAuth avec un mail r&#233;capitulatif.<br/>"
            "&#8226; S. Garcia&#160;: organiser la session beta mobile interne.",
            body,
        ),
        Paragraph("Prochain rendez-vous", h2),
        Paragraph("Sprint review #42&#160;: vendredi 15 mai 2026, 14h00, salle Voltaire.", body),
    ]
    doc.build(story)


if __name__ == "__main__":
    build_contract()
    build_invoice()
    build_id_card()
    build_meeting_notes()
    for p in OUT.glob("*.pdf"):
        print(f"  {p.name}: {p.stat().st_size} bytes")
    print("done.")
