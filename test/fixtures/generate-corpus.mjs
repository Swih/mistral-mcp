/**
 * Build the `process_document` evaluation corpus.
 *
 *   npm run fixtures:generate
 *
 * Writes `corpus/*.pdf` plus `corpus.json`, the manifest that carries each
 * document's ground truth. Everything here is synthetic: invented companies,
 * invented people, invented numbers. There is no real PII in this repo and
 * none should ever be added — the point of the corpus is to be publishable.
 *
 * The corpus is deliberately awkward, because "heterogeneous PDF ingestion" is
 * where document pipelines actually break. It covers, on purpose:
 *
 *   - a rotated landscape page (/Rotate 90), the shape of a scanned A4 fed
 *     sideways through a sheet feeder;
 *   - ruled tables, which OCR either reconstructs or smears into one line;
 *   - a two-column layout, where naive reading order interleaves the columns;
 *   - a near-empty page, the case `minOcrConfidence` exists to catch;
 *   - a blank page in the middle of a document, which breaks page indexing;
 *   - French accents and the euro sign, mixed FR/EN in one document;
 *   - a document whose declared kind is ambiguous, to exercise `kind: "auto"`.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PdfDocument, A4 } from "./pdf-writer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "corpus");

/* ------------------------------------------------------------------ docs -- */

function contractFr() {
  const doc = new PdfDocument();
  const p1 = doc.addPage();
  p1.text(50, 60, "CONTRAT DE PRESTATION DE SERVICES", { size: 16, bold: true });
  p1.lines(50, 100, [
    "Entre les soussignés :",
    "",
    "ACME SAS, société au capital de 50 000 €, dont le siège social est situé",
    "12 rue de la Paix, 75002 Paris, immatriculée au RCS de Paris sous le",
    "numéro 845 327 109, représentée par M. Jean Dupont, Président,",
    "ci-après désignée « le Prestataire »,",
    "",
    "et",
    "",
    "BetaCorp SARL, société au capital de 20 000 €, dont le siège social est",
    "situé 8 avenue Victor Hugo, 69006 Lyon, immatriculée au RCS de Lyon",
    "sous le numéro 512 884 660, représentée par Mme Claire Morel, Gérante,",
    "ci-après désignée « le Client ».",
  ]);
  p1.text(50, 330, "ARTICLE 1 — OBJET", { size: 12, bold: true });
  p1.lines(50, 355, [
    "Le Prestataire s'engage à fournir au Client des prestations d'intégration",
    "logicielle et de maintenance applicative, telles que décrites en annexe A.",
  ]);
  p1.text(50, 410, "ARTICLE 2 — DURÉE", { size: 12, bold: true });
  p1.lines(50, 435, [
    "Le présent contrat est conclu pour une durée de douze (12) mois à compter",
    "du 1er septembre 2026, renouvelable par tacite reconduction.",
  ]);
  p1.text(50, 490, "ARTICLE 3 — PRIX ET MODALITÉS DE PAIEMENT", { size: 12, bold: true });
  p1.lines(50, 515, [
    "La rémunération forfaitaire est fixée à 96 000 € HT par an, facturée",
    "mensuellement à terme échu. Paiement à 30 jours date de facture.",
  ]);

  const p2 = doc.addPage();
  p2.text(50, 60, "ARTICLE 4 — RESPONSABILITÉ", { size: 12, bold: true });
  p2.lines(50, 85, [
    "La responsabilité du Prestataire est plafonnée au montant total des sommes",
    "versées au titre du contrat au cours des douze derniers mois.",
  ]);
  p2.text(50, 140, "ARTICLE 5 — RÉSILIATION", { size: 12, bold: true });
  p2.lines(50, 165, [
    "Chaque partie peut résilier le contrat moyennant un préavis de trois (3)",
    "mois notifié par lettre recommandée avec accusé de réception.",
  ]);
  p2.text(50, 220, "ARTICLE 6 — DROIT APPLICABLE", { size: 12, bold: true });
  p2.lines(50, 245, [
    "Le présent contrat est régi par le droit français. Tout litige relève de la",
    "compétence exclusive du Tribunal de commerce de Paris.",
  ]);
  p2.lines(50, 330, ["Fait à Paris, le 15 août 2026, en deux exemplaires originaux."]);
  p2.text(50, 400, "Pour ACME SAS", { bold: true });
  p2.text(320, 400, "Pour BetaCorp SARL", { bold: true });
  p2.text(50, 420, "Jean Dupont, Président");
  p2.text(320, 420, "Claire Morel, Gérante");

  return {
    file: "contract-fr.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "contract",
      page_count: 2,
      text_extractable: true,
      must_contain: ["ACME SAS", "BetaCorp", "845 327 109", "96 000"],
      notes: "Two-page French services contract. Baseline for the contract kind.",
    },
  };
}

function invoiceFrTable() {
  const doc = new PdfDocument();
  const p = doc.addPage();
  p.text(50, 55, "FACTURE", { size: 18, bold: true });
  p.lines(50, 90, [
    "ACME SAS — 12 rue de la Paix, 75002 Paris",
    "TVA intracommunautaire : FR 42 845327109",
  ], { size: 9 });
  p.lines(360, 90, [
    "Facture n° 2026-0842",
    "Date : 12/08/2026",
    "Échéance : 11/09/2026",
  ], { size: 9 });
  p.lines(50, 150, ["Client : BetaCorp SARL", "8 avenue Victor Hugo, 69006 Lyon"], { size: 10 });

  p.row(210, [[50, "Désignation"], [330, "Qté"], [390, "PU HT"], [480, "Total HT"]], {
    bold: true,
    rule: true,
  });
  const items = [
    ["Intégration module facturation", "12", "650,00 €", "7 800,00 €"],
    ["Maintenance applicative (août)", "1", "1 200,00 €", "1 200,00 €"],
    ["Formation utilisateurs (2 jours)", "2", "900,00 €", "1 800,00 €"],
  ];
  items.forEach(([label, qty, unit, total], i) => {
    p.row(235 + i * 22, [[50, label], [330, qty], [390, unit], [480, total]], { rule: true });
  });

  p.row(325, [[390, "Total HT"], [480, "10 800,00 €"]], { bold: true });
  p.row(345, [[390, "TVA 20 %"], [480, "2 160,00 €"]]);
  p.row(365, [[390, "Total TTC"], [480, "12 960,00 €"]], { bold: true, rule: true });
  p.lines(50, 430, [
    "Règlement par virement sous 30 jours. IBAN FR76 3000 4000 0100 0012 3456 789.",
    "Pénalités de retard : 3 fois le taux d'intérêt légal. Indemnité forfaitaire : 40 €.",
  ], { size: 9 });

  return {
    file: "invoice-fr-table.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "invoice",
      page_count: 1,
      text_extractable: true,
      must_contain: ["2026-0842", "12 960,00", "BetaCorp", "TVA"],
      notes: "Ruled line-item table. OCR either reconstructs the columns or smears them.",
    },
  };
}

function invoiceEnTwoColumn() {
  const doc = new PdfDocument();
  const p = doc.addPage();
  p.text(50, 55, "INVOICE", { size: 18, bold: true });
  // Two independent column blocks: naive reading order interleaves them.
  p.lines(50, 95, [
    "From",
    "Northwind Logistics Ltd",
    "44 Dock Road",
    "Bristol BS1 6XN",
    "United Kingdom",
    "VAT GB 384 2910 55",
  ], { size: 9 });
  p.lines(330, 95, [
    "Bill to",
    "ACME SAS",
    "12 rue de la Paix",
    "75002 Paris",
    "France",
    "VAT FR 42 845327109",
  ], { size: 9 });

  p.lines(50, 200, ["Invoice number: NW-2026-1177", "Issue date: 2026-08-03", "Due date: 2026-09-02"], {
    size: 10,
  });

  p.row(270, [[50, "Description"], [360, "Hours"], [430, "Rate"], [500, "Amount"]], {
    bold: true,
    rule: true,
  });
  const rows = [
    ["Freight consolidation, July", "38.5", "GBP 62.00", "GBP 2,387.00"],
    ["Customs documentation", "6.0", "GBP 85.00", "GBP 510.00"],
  ];
  rows.forEach(([d, h, r, a], i) =>
    p.row(295 + i * 22, [[50, d], [360, h], [430, r], [500, a]], { rule: true })
  );
  p.row(370, [[430, "Subtotal"], [500, "GBP 2,897.00"]], { bold: true });
  p.row(390, [[430, "VAT (reverse charge)"], [500, "GBP 0.00"]]);
  p.row(410, [[430, "Total due"], [500, "GBP 2,897.00"]], { bold: true, rule: true });

  return {
    file: "invoice-en-twocol.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "invoice",
      page_count: 1,
      text_extractable: true,
      must_contain: ["NW-2026-1177", "Northwind", "2,897.00"],
      notes: "English invoice, side-by-side address blocks. Tests reading order and non-EUR currency.",
    },
  };
}

function idCardSynthetic() {
  const doc = new PdfDocument();
  const p = doc.addPage({ width: 420, height: 260 });
  p.text(20, 30, "RÉPUBLIQUE DE SYNTHÉTIE", { size: 11, bold: true });
  p.text(20, 48, "CARTE NATIONALE D'IDENTITÉ — SPÉCIMEN", { size: 9 });
  p.rule(20, 58, 400, 58);
  p.lines(20, 85, [
    "Nom : MARTIN",
    "Prénom(s) : Camille Léa",
    "Né(e) le : 14/03/1991 à Tours (37)",
    "Sexe : F   Nationalité : Synthétienne",
    "N° du document : SPEC-000-000-000",
    "Date d'expiration : 31/12/2035",
  ], { size: 9 });
  p.text(20, 215, "DOCUMENT FICTIF — GÉNÉRÉ POUR TESTS AUTOMATISÉS", { size: 7, bold: true });

  return {
    file: "id-card-synthetic.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "id_document",
      page_count: 1,
      text_extractable: true,
      must_contain: ["MARTIN", "SPEC-000-000-000"],
      // The cache bypass for id_document is the behaviour under test here, not
      // the extraction quality.
      asserts_cache_bypass: true,
      notes: "Non-A4 card format. Fictional country and identifiers; not a real document.",
    },
  };
}

function meetingNotesMixed() {
  const doc = new PdfDocument();
  const p = doc.addPage();
  p.text(50, 60, "Comité de pilotage — Projet ORION", { size: 15, bold: true });
  p.lines(50, 95, [
    "Date : 20 août 2026 — 14h00 à 15h30 (CEST)",
    "Présents : C. Morel (BetaCorp), J. Dupont (ACME), S. Okafor (Northwind)",
  ], { size: 9 });
  p.text(50, 145, "1. Avancement / Progress", { size: 12, bold: true });
  p.lines(50, 170, [
    "Le lot 2 est livré avec deux semaines d'avance. Migration des données",
    "clients terminée à 92 %.",
    "Northwind confirmed the customs interface passed UAT on 18 August.",
  ]);
  p.text(50, 245, "2. Points de blocage / Blockers", { size: 12, bold: true });
  p.lines(50, 270, [
    "L'accès à l'environnement de recette est encore restreint côté client.",
    "Waiting on a firewall change request, ticket INF-4412, owner: S. Okafor.",
  ]);
  p.text(50, 330, "3. Décisions", { size: 12, bold: true });
  p.lines(50, 355, [
    "— Le jalon de recette est décalé au 15 septembre 2026.",
    "— Budget complémentaire de 18 000 € validé pour le lot 3.",
    "— Next steering committee: 17 September 2026, 14:00 CEST.",
  ]);

  return {
    file: "meeting-notes-mixed.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "generic",
      page_count: 1,
      text_extractable: true,
      must_contain: ["ORION", "INF-4412", "15 septembre"],
      notes: "FR/EN in one document. Baseline for the generic kind.",
    },
  };
}

function reportLandscapeRotated() {
  const doc = new PdfDocument();
  // Portrait media box with /Rotate 90 — what a sheet feeder produces when an
  // A4 page goes through sideways, and a classic ingestion failure.
  for (const [index, title] of [
    ["1", "SITUATION LOGISTIQUE — SEMAINE 34"],
    ["2", "SITUATION LOGISTIQUE — SEMAINE 34 (SUITE)"],
  ]) {
    const p = doc.addPage({ rotate: 90 });
    p.text(50, 60, title, { size: 14, bold: true });
    p.text(50, 85, `Page ${index} / 2 — diffusion restreinte (fictif)`, { size: 8 });
    p.row(130, [[50, "Site"], [200, "Stock"], [300, "Rupture"], [400, "Délai"]], {
      bold: true,
      rule: true,
    });
    const rows =
      index === "1"
        ? [
            ["Rouen", "1 240", "non", "48 h"],
            ["Le Havre", "310", "oui", "6 j"],
            ["Marseille", "2 005", "non", "24 h"],
          ]
        : [
            ["Bordeaux", "870", "non", "72 h"],
            ["Lille", "95", "oui", "9 j"],
          ];
    rows.forEach(([site, stock, rupture, delai], i) =>
      p.row(155 + i * 22, [[50, site], [200, stock], [300, rupture], [400, delai]], { rule: true })
    );
    p.lines(50, 280, [
      "Commentaire : la rupture du Havre est liée au retard du convoi CMA-3391.",
      "Action : réallocation depuis Rouen validée par le chef de section.",
    ], { size: 9 });
  }

  return {
    file: "report-landscape-rotated.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "generic",
      page_count: 2,
      text_extractable: true,
      must_contain: ["Le Havre", "CMA-3391"],
      notes:
        "/Rotate 90 on both pages. If a pipeline ignores /Rotate the text is there but the layout is wrong.",
    },
  };
}

function scanSparse() {
  const doc = new PdfDocument();
  const p = doc.addPage();
  // A page carrying almost nothing: the case minOcrConfidence is for.
  p.text(180, 400, "ANNEXE B", { size: 12, bold: true });
  p.text(150, 425, "(page laissée intentionnellement vierge)", { size: 8 });

  return {
    file: "scan-sparse.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "generic",
      page_count: 1,
      text_extractable: true,
      // Two short lines on an A4 page: the confidence signal, if it means
      // anything, should be visibly lower here than on the dense documents.
      low_signal: true,
      must_contain: ["ANNEXE B"],
      notes:
        "Near-empty page. Used to calibrate minOcrConfidence: a threshold that rejects this and accepts the dense documents is defensible; one that rejects both is not.",
    },
  };
}

function multipageWithBlank() {
  const doc = new PdfDocument();
  const cover = doc.addPage();
  cover.text(50, 200, "DOSSIER TECHNIQUE", { size: 20, bold: true });
  cover.text(50, 235, "Référence : DT-2026-0091", { size: 11 });
  cover.text(50, 255, "Version 3 — 22 août 2026", { size: 11 });

  const table = doc.addPage();
  table.text(50, 60, "Annexe 1 — Nomenclature", { size: 13, bold: true });
  table.row(110, [[50, "Réf."], [160, "Désignation"], [420, "Qté"]], { bold: true, rule: true });
  [
    ["NX-100", "Module de commande", "4"],
    ["NX-214", "Capteur de température", "12"],
    ["NX-880", "Faisceau de raccordement", "6"],
  ].forEach(([ref, label, qty], i) =>
    table.row(135 + i * 22, [[50, ref], [160, label], [420, qty]], { rule: true })
  );

  // A genuinely empty page in the middle — page indexing must not shift.
  doc.addPage();

  const dense = doc.addPage();
  dense.text(50, 60, "Annexe 2 — Procédure de recette", { size: 13, bold: true });
  dense.lines(50, 95, [
    "1. Vérifier la mise à la terre de l'armoire avant toute intervention.",
    "2. Contrôler la tension d'alimentation : 230 V ± 10 %, 50 Hz.",
    "3. Lancer l'auto-test intégré et relever le code de retour.",
    "4. Un code différent de 0000 impose l'arrêt de la procédure et",
    "   l'ouverture d'une fiche d'anomalie auprès du service qualité.",
    "5. Consigner les relevés dans le registre RG-2026 et faire contresigner",
    "   par le responsable d'atelier.",
    "6. Archiver le procès-verbal de recette pendant une durée de dix ans.",
  ], { size: 10 });

  return {
    file: "multipage-blank-inside.pdf",
    bytes: doc.render(),
    truth: {
      expected_kind: "generic",
      page_count: 4,
      text_extractable: true,
      blank_page_index: 2,
      must_contain: ["DT-2026-0091", "NX-214", "RG-2026"],
      notes: "Cover, table, blank page, dense text. The blank page must not shift page indexing.",
    },
  };
}

/* ------------------------------------------------------------------ main -- */

const BUILDERS = [
  contractFr,
  invoiceFrTable,
  invoiceEnTwoColumn,
  idCardSynthetic,
  meetingNotesMixed,
  reportLandscapeRotated,
  scanSparse,
  multipageWithBlank,
];

export function buildCorpus() {
  return BUILDERS.map((build) => build());
}

export function writeCorpus(outDir = OUT) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const documents = buildCorpus().map((doc) => {
    writeFileSync(resolve(outDir, doc.file), doc.bytes);
    return { file: doc.file, bytes: doc.bytes.length, ...doc.truth };
  });

  const manifest = {
    generated_by: "test/fixtures/generate-corpus.mjs",
    synthetic: true,
    note:
      "Every company, person, identifier and amount here is invented. No real PII. " +
      "Regenerate with `npm run fixtures:generate`.",
    documents,
  };
  writeFileSync(
    resolve(outDir, "..", "corpus.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  return manifest;
}

// pathToFileURL, not string concatenation: on Windows the drive letter makes
// `file://C:/...` and `file:///C:/...` differ and the check silently never fires.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = writeCorpus();
  for (const d of manifest.documents) {
    console.log(`${d.file.padEnd(30)} ${String(d.bytes).padStart(6)} B  ${d.expected_kind}`);
  }
  console.log(`\n${manifest.documents.length} documents -> test/fixtures/corpus/`);
}
