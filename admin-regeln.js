// Reine Logik der Admin-Seite (Ticket #43), ohne Seite und ohne Netz, damit sie getestet
// werden kann. Angezeigt wird in admin.js. Anleitung: doku/ANLEITUNG-ADMIN.md
//
// GitHub: Die Seite spricht direkt mit der GitHub-API (sie erlaubt Anfragen aus dem Browser).
// Das Token gibt die Admin selbst ein; es bleibt nur in diesem Browser-Tab (sessionStorage)
// und ist beim Schließen des Tabs weg. Es steht nie im Code.

const ADMIN_REPO = "FlohmiApp/Flohmi";
const GITHUB_API = "https://api.github.com";
const TOKEN_SPEICHER = "flohmi-admin-github";

// Workflows mit „Run workflow“ (workflow_dispatch). Alle laufen nur auf main.
// Ein Test prüft, dass die Liste zu .github/workflows/ passt. gruppe: wo er im Menü steht.
const STARTBARE_WORKFLOWS = [
  { datei: "sammeln.yml", titel: "Märkte sammeln", gruppe: "maerkte", symbol: "🔄",
    text: "Holt neue Märkte und übernimmt freigegebene Meldungen in die App (läuft sonst alle 3 Stunden)." },
  { datei: "play-store-build.yml", titel: "App Bundle erstellen und hochladen", gruppe: "veroeffentlichen", symbol: "📦",
    text: "Baut das signierte App Bundle, wenn es zum Stand auf main ein Release gibt, und lädt es als " +
      "Entwurf in den internen Test von Google Play (ohne Dienstkonto liegt es nur am Lauf)." },
  { datei: "rechtliches-seiten.yml", titel: "Rechtstexte veröffentlichen", gruppe: "wartung", symbol: "⚖️",
    text: "Baut die öffentlichen Seiten zu Datenschutz, Impressum und „Konto löschen“ neu." },
  { datei: "supabase-migrationen.yml", titel: "Datenbank-Migrationen", gruppe: "wartung", symbol: "🗄️",
    text: "Überträgt neue Datenbank-Änderungen aus supabase/migrations." },
  { datei: "tag-nach-merge.yml", titel: "Tag und Release nachholen", gruppe: "wartung", symbol: "🏷️",
    text: "Setzt Tag und Release für den letzten Merge nach main, falls sie fehlen." }
];

// --- Menü (Ticket #111) ------------------------------------------------------------------
// Gruppen nach Aufgaben. Jeder Bereich der Seite steht genau einmal im Menü.
// bereich: Ziel in der Adresse (#meldungen, #workflow:sammeln.yml …); github: braucht die
// GitHub-Verbindung; aktion: kein Bereich, sondern ein Knopf (Abmelden).
const MENUE_GRUPPEN = [
  { id: "maerkte", titel: "Märkte", symbol: "🛍️", eintraege: [
    { bereich: "meldungen", titel: "Offene Meldungen", symbol: "📋" }
  ] },
  { id: "veroeffentlichen", titel: "Veröffentlichen", symbol: "🚀", eintraege: [
    // Ticket #127: die Schritte zum Veröffentlichen in ihrer Reihenfolge; „App Bundle erstellen
    // und hochladen“ ist ein Workflow und kommt dahinter (STARTBARE_WORKFLOWS).
    { bereich: "tester", titel: "Testerdatenbank", symbol: "🧪" },
    { bereich: "prs", titel: "Änderungen in develop übernehmen", symbol: "🔀", github: true },
    { bereich: "main", titel: "Release nach main bringen", symbol: "⏫", github: true }
  ] },
  { id: "wartung", titel: "Wartung", symbol: "🛠️", eintraege: [
    { bereich: "architektur", titel: "Architektur und Workflows", symbol: "🗺️", github: true }
  ] },
  { id: "verbindung", titel: "Verbindung", symbol: "🔑", eintraege: [
    { bereich: "dienste", titel: "Dienste und Zugänge", symbol: "🧰" },
    { bereich: "github", titel: "GitHub-Verbindung", symbol: "🔗" },
    { aktion: "abmelden", titel: "Abmelden", symbol: "🚪" }
  ] }
];
const START_BEREICH = "meldungen";

// Das fertige Menü: Gruppen mit ihren Einträgen; die Workflows stehen in ihrer Gruppe
// jeweils nach den festen Einträgen.
function adminMenue() {
  return MENUE_GRUPPEN.map(function (gruppe) {
    const workflows = STARTBARE_WORKFLOWS.filter((w) => w.gruppe === gruppe.id).map((w) => ({
      bereich: "workflow:" + w.datei, titel: w.titel, symbol: w.symbol, github: true, workflow: w.datei
    }));
    return { ...gruppe, eintraege: gruppe.eintraege.concat(workflows) };
  });
}

// Alle Einträge, die zu einem Bereich führen (ohne Knöpfe wie „Abmelden“).
function menueBereiche() {
  return adminMenue().flatMap((gruppe) => gruppe.eintraege.filter((e) => e.bereich).map((e) => ({ ...e, gruppe: gruppe.id })));
}

// „#workflow:sammeln.yml“ → der passende Menüeintrag, sonst null (dann zeigt die Seite das Menü
// bzw. am PC den Startbereich).
function bereichAusAdresse(adresse) {
  const name = decodeURIComponent(String(adresse || "").replace(/^#/, ""));
  return menueBereiche().find((eintrag) => eintrag.bereich === name) || null;
}

// Ein GitHub-Token hat eines dieser Formate (fein abgestuft, klassisch, OAuth).
function tokenPruefen(token) {
  const wert = String(token || "").trim();
  if (!wert) return "Bitte ein GitHub-Token eingeben.";
  if (!/^(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})$/.test(wert)) {
    return "Das sieht nicht wie ein GitHub-Token aus (beginnt mit github_pat_ oder ghp_).";
  }
  return "";
}

// Beschreibt eine Anfrage an die GitHub-API: { methode, adresse, daten }.
function githubAnfrage(art, werte = {}) {
  const repo = GITHUB_API + "/repos/" + ADMIN_REPO;
  switch (art) {
    case "ich": return { methode: "GET", adresse: GITHUB_API + "/user" };
    case "repo": return { methode: "GET", adresse: repo };
    case "workflowStarten":
      return { methode: "POST", adresse: repo + "/actions/workflows/" + encodeURIComponent(werte.datei) + "/dispatches",
        daten: { ref: "main" } };
    case "letzteLaeufe":
      return { methode: "GET", adresse: repo + "/actions/workflows/" + encodeURIComponent(werte.datei) + "/runs?per_page=3" };
    case "offenePrs":
      return { methode: "GET", adresse: repo + "/pulls?state=open&base=" + encodeURIComponent(werte.basis) + "&per_page=50" };
    case "pr": return { methode: "GET", adresse: repo + "/pulls/" + Number(werte.nummer) };
    case "prMergen":
      // „merge“ (kein Squash): So erkennt tag-nach-merge.yml den Merge develop → main.
      return { methode: "PUT", adresse: repo + "/pulls/" + Number(werte.nummer) + "/merge",
        daten: { merge_method: "merge", sha: werte.sha } };
    case "vergleich":
      return { methode: "GET", adresse: repo + "/compare/" + encodeURIComponent(werte.basis) + "..." + encodeURIComponent(werte.kopf) };
    case "datei":
      // Rohinhalt einer Datei aus dem (privaten) Repository, z. B. ein Architekturbild.
      return { methode: "GET", roh: true,
        adresse: repo + "/contents/" + String(werte.pfad).split("/").map(encodeURIComponent).join("/") +
          "?ref=" + encodeURIComponent(werte.ref) };
    case "prAnlegen":
      return { methode: "POST", adresse: repo + "/pulls",
        daten: { title: werte.titel, head: werte.kopf, base: werte.basis, body: werte.text || "" } };
    default:
      throw new Error("Unbekannte Anfrage: " + art);
  }
}

// Übersetzt eine Fehlerantwort von GitHub in einen verständlichen Satz.
function githubFehlerText(status, nachricht) {
  const text = String(nachricht || "");
  if (status === 401) return "Das GitHub-Token ist ungültig oder abgelaufen. Bitte neu eingeben.";
  if (status === 403 && /rate limit/i.test(text)) return "GitHub hat zu viele Anfragen gezählt. Bitte in ein paar Minuten noch einmal.";
  if (status === 403) return "Das GitHub-Token hat dafür keine Rechte (nötig: Contents, Pull requests und Actions mit Schreibrechten).";
  if (status === 404) return "Nicht gefunden. Hat das Token Zugriff auf " + ADMIN_REPO + "?";
  if (status === 405) return "Der Pull Request lässt sich nicht mergen: " + (text || "Prüfungen oder Freigaben fehlen.");
  if (status === 409) return "Konflikt: Der Pull Request hat Merge-Konflikte oder wurde inzwischen geändert. Seite neu laden und prüfen.";
  if (status === 422 && /workflow_dispatch/i.test(text)) return "Dieser Workflow lässt sich nicht von Hand starten.";
  if (status === 422) return "GitHub hat die Anfrage abgelehnt: " + (text || "ungültige Angaben") + ".";
  if (!status) return "Keine Verbindung zu GitHub. Bitte Internet prüfen.";
  return "GitHub meldet Fehler " + status + (text ? ": " + text : "") + ".";
}

// Zustand eines Pull Requests für die Anzeige. mergeable ist bei GitHub anfangs oft null
// („wird noch berechnet“), dann lieber kurz warten als blind mergen.
function prZustand(pr) {
  if (!pr) return { mergebar: false, text: "unbekannt" };
  if (pr.draft) return { mergebar: false, text: "Entwurf" };
  if (pr.mergeable === null || pr.mergeable === undefined) return { mergebar: false, text: "wird noch geprüft …" };
  if (pr.mergeable === false || pr.mergeable_state === "dirty") return { mergebar: false, text: "hat Konflikte" };
  if (pr.mergeable_state === "blocked") return { mergebar: false, text: "blockiert (Prüfungen oder Freigabe fehlen)" };
  if (pr.mergeable_state === "unstable") return { mergebar: true, text: "mergebar, aber Prüfungen sind nicht grün" };
  if (pr.mergeable_state === "behind") return { mergebar: true, text: "mergebar (Basis ist inzwischen weiter)" };
  return { mergebar: true, text: "mergebar" };
}

// Status eines Workflow-Laufs in Worten.
function laufText(lauf) {
  if (!lauf) return "noch nie gelaufen";
  const zeit = new Date(lauf.created_at).toLocaleString("de-DE", { timeZone: "Europe/Berlin",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  if (lauf.status !== "completed") return zeit + ": läuft gerade";
  const ergebnis = { success: "erfolgreich", failure: "fehlgeschlagen", cancelled: "abgebrochen",
    skipped: "übersprungen" }[lauf.conclusion] || lauf.conclusion || "beendet";
  return zeit + ": " + ergebnis;
}

// Text für die Bestätigung vor einem Merge.
function mergeFrage(pr, basis) {
  return "Pull Request #" + pr.number + " „" + pr.title + "“ wirklich nach " + basis + " mergen?" +
    (basis === "main" ? "\n\nDanach starten Tag, Release, Migrationen und der Build für Google Play." : "");
}

// --- Meldungen (Supabase) ---------------------------------------------------------------

const MELDUNG_SPALTEN = "id, name, art, datum, beginn, ende, ort, adresse, standgebuehr, eintritt, " +
  "telefon, mobil, email, kontakt_einverstanden, kontakt, hinweis, status, erstellt_am";

// Aufbereitete Zeilen für eine offene Meldung: [Bezeichnung, Wert], leere Werte fallen weg.
function meldungZeilen(meldung) {
  const datum = /^\d{4}-\d{2}-\d{2}$/.test(String(meldung.datum || ""))
    ? meldung.datum.split("-").reverse().join(".") : String(meldung.datum || "");
  const zeilen = [
    ["Art", meldung.art],
    ["Datum", datum + (meldung.beginn ? ", " + meldung.beginn + "–" + (meldung.ende || "") + " Uhr" : "")],
    ["Adresse", meldung.adresse],
    ["Standgebühr", meldung.standgebuehr],
    ["Eintritt", meldung.eintritt],
    ["Telefon (öffentlich)", meldung.telefon],
    ["Mobil (öffentlich)", meldung.mobil],
    ["E-Mail (öffentlich)", meldung.email],
    ["Kontakt (intern)", meldung.kontakt],
    ["Hinweis (intern)", meldung.hinweis]
  ];
  if (meldung.telefon || meldung.mobil || meldung.email) {
    zeilen.push(["Veröffentlichen erlaubt", meldung.kontakt_einverstanden ? "ja" : "NEIN, nicht freigeben"]);
  }
  return zeilen.filter(([, wert]) => wert !== null && wert !== undefined && String(wert).trim() !== "");
}

// Darf die Meldung freigegeben werden? Vergangene Termine und Kontaktdaten ohne Erlaubnis nicht.
function freigabePruefen(meldung, heute = new Date()) {
  const tag = new Date(heute.getTime() - heute.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (String(meldung.datum) < tag) return "Der Termin ist schon vorbei.";
  if ((meldung.telefon || meldung.mobil || meldung.email) && !meldung.kontakt_einverstanden) {
    return "Telefon, Mobil oder E-Mail ohne Erlaubnis zum Veröffentlichen.";
  }
  return "";
}

// --- Architektur und Workflows (Ticket #113) ----------------------------------------------
// Die Bilder liegen nur im privaten Repository (doku/architektur/, Erklärung in LIESMICH.md).
// Die Seite holt sie mit dem GitHub-Token der Admin über die API, so sind sie nirgends
// öffentlich und immer auf dem Stand von develop. Ein Test prüft, dass die Liste zum Ordner passt.
const ARCHITEKTUR_BRANCH = "develop";
const ARCHITEKTUR_BILDER = [
  { datei: "doku/architektur/architektur-app.svg", titel: "App und Dienste" },
  { datei: "doku/architektur/architektur-workflows.svg", titel: "Entwicklung und Workflows" }
];
const ARCHITEKTUR_ERKLAERUNG = "doku/architektur/LIESMICH.md";
const ZOOM_STUFEN = [0.5, 0.75, 1, 1.5, 2, 3];

// Link zur Datei auf GitHub (öffnet nur, wer Zugriff auf das Repository hat).
function githubDateiLink(pfad, ref = ARCHITEKTUR_BRANCH) {
  return "https://github.com/" + ADMIN_REPO + "/blob/" + encodeURIComponent(ref) + "/" +
    String(pfad).split("/").map(encodeURIComponent).join("/");
}

// Nächste Zoomstufe: richtung +1 größer, -1 kleiner; null = an die Breite angepasst.
// Aus „angepasst“ heraus geht es von 100 % aus weiter.
function zoomAendern(aktuell, richtung) {
  const basis = aktuell === null ? 1 : aktuell;
  if (richtung > 0) return ZOOM_STUFEN.find((stufe) => stufe > basis + 1e-9) ?? ZOOM_STUFEN[ZOOM_STUFEN.length - 1];
  return [...ZOOM_STUFEN].reverse().find((stufe) => stufe < basis - 1e-9) ?? ZOOM_STUFEN[0];
}

function zoomText(stufe) {
  return stufe === null ? "an Breite angepasst" : Math.round(stufe * 100) + " %";
}

// --- Dienste und Zugänge (Ticket #77) ------------------------------------------------------
// Tabelle „admin_dienste“, nur für Admins (Migration 20261112190000_admin_dienste.sql).
// Hier stehen Links und Kontonamen, nie Passwörter, Schlüssel oder Tokens.

const DIENST_SPALTEN = "id, reihenfolge, dienst, zweck, link, konto, hinweis";
const DIENST_FELDER = {
  dienst: { name: "Dienst", laenge: 100, pflicht: true },
  zweck: { name: "Wofür", laenge: 300 },
  link: { name: "Link", laenge: 300 },
  konto: { name: "Konto", laenge: 200 },
  hinweis: { name: "Hinweis", laenge: 300 }
};
// Sieht nach Passwort, Schlüssel oder Token aus (wie die Regel in der Datenbank).
// [t] und [e]: Das Muster selbst soll nicht wie ein Schlüssel aussehen (Prüfung beim Veröffentlichen).
const GEHEIMNIS_MUSTER = /sb_secre[t]_|service_rol[e]|ghp_[a-z0-9]{20}|github_pat_|sk-ant-|-----begin|passwor[dt]\s*[:=]/i;

// Bereinigt und prüft die Eingaben. Gibt { werte, fehler } zurück; fehler: Feld → Text.
function dienstPruefen(eingabe) {
  const werte = {};
  const fehler = {};
  for (const [feld, regel] of Object.entries(DIENST_FELDER)) {
    const wert = String((eingabe && eingabe[feld]) || "").trim();
    werte[feld] = wert || null;
    if (regel.pflicht && !wert) fehler[feld] = "Bitte ausfüllen.";
    else if ([...wert].length > regel.laenge) fehler[feld] = "Höchstens " + regel.laenge + " Zeichen.";
    else if (GEHEIMNIS_MUSTER.test(wert)) fehler[feld] = "Keine Passwörter, Schlüssel oder Tokens eintragen.";
  }
  if (werte.link && !fehler.link && !/^https:\/\/[^\s]+$/.test(werte.link)) {
    fehler.link = "Bitte eine vollständige Adresse mit https:// eingeben.";
  }
  return { werte, fehler };
}

// Reihenfolge für einen neuen Eintrag: hinter dem letzten.
function naechsteReihenfolge(dienste) {
  return (dienste || []).reduce((hoechste, d) => Math.max(hoechste, Number(d.reihenfolge) || 0), 0) + 10;
}

// Noch auszufüllen? („TODO“ im Konto.)
function dienstUnvollstaendig(dienst) {
  return /\bTODO\b/i.test(String(dienst.konto || ""));
}

// --- Testerinnen und Tester (Ticket #122) --------------------------------------------------
// Tabelle „admin_tester“, nur für Admins (Migration 20261112210000_admin_tester.sql).
// Personen, die die Android-App für Google Play testen. Nur zur eigenen Übersicht.

const TESTER_SPALTEN = "id, name, telefon, google_mail";
const TESTER_FELDER = {
  name: { name: "Name", laenge: 100, pflicht: true },
  telefon: { name: "Telefonnummer", laenge: 30 },
  google_mail: { name: "Google-Mail", laenge: 200 }
};

// Bereinigt und prüft die Eingaben (wie die Regeln in der Datenbank).
// Gibt { werte, fehler } zurück; fehler: Feld → Text.
function testerPruefen(eingabe) {
  const werte = {};
  const fehler = {};
  for (const [feld, regel] of Object.entries(TESTER_FELDER)) {
    const wert = String((eingabe && eingabe[feld]) || "").trim();
    werte[feld] = wert || null;
    if (regel.pflicht && !wert) fehler[feld] = "Bitte ausfüllen.";
    else if ([...wert].length > regel.laenge) fehler[feld] = "Höchstens " + regel.laenge + " Zeichen.";
  }
  if (werte.telefon && !fehler.telefon && !/^\+?[0-9 ()/-]{3,30}$/.test(werte.telefon)) {
    fehler.telefon = "Nur Ziffern, Leerzeichen, + ( ) / und -.";
  }
  if (werte.google_mail && !fehler.google_mail) {
    werte.google_mail = werte.google_mail.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(werte.google_mail)) fehler.google_mail = "Bitte eine vollständige E-Mail-Adresse eingeben.";
  }
  return { werte, fehler };
}

// Alle Google-Mails, durch Komma getrennt, ohne doppelte: So lassen sie sich in der
// Play Console bei „Tester“ in eine E-Mail-Liste einfügen.
function testerMails(tester) {
  const mails = (tester || []).map((t) => String(t.google_mail || "").trim().toLowerCase()).filter(Boolean);
  return [...new Set(mails)].join(", ");
}

// „1 Person“ / „3 Personen“
function testerAnzahlText(anzahl) {
  return anzahl === 1 ? "1 Person" : anzahl + " Personen";
}

if (typeof module !== "undefined") {
  module.exports = {
    ADMIN_REPO, GITHUB_API, TOKEN_SPEICHER, STARTBARE_WORKFLOWS, MELDUNG_SPALTEN,
    MENUE_GRUPPEN, START_BEREICH, adminMenue, menueBereiche, bereichAusAdresse,
    ARCHITEKTUR_BRANCH, ARCHITEKTUR_BILDER, ARCHITEKTUR_ERKLAERUNG, ZOOM_STUFEN, githubDateiLink, zoomAendern, zoomText,
    DIENST_SPALTEN, DIENST_FELDER, GEHEIMNIS_MUSTER, dienstPruefen, naechsteReihenfolge, dienstUnvollstaendig,
    TESTER_SPALTEN, TESTER_FELDER, testerPruefen, testerMails, testerAnzahlText,
    tokenPruefen, githubAnfrage, githubFehlerText, prZustand, laufText, mergeFrage,
    meldungZeilen, freigabePruefen
  };
}
