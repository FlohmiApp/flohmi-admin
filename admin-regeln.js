// Reine Logik der Admin-Seite (Ticket #43), ohne Seite und ohne Netz, damit sie getestet
// werden kann. Angezeigt wird in admin.js. Anleitung: doku/ANLEITUNG-ADMIN.md
//
// GitHub (Ticket #137): Die Seite spricht nicht selbst mit GitHub, sondern mit der Supabase
// Edge Function „github“ (supabase/functions/github/). Sie schickt nur { art, werte } und das
// Zugangs-Token ihrer Supabase-Anmeldung. Das GitHub-Token liegt nur in Supabase (Secret
// FLOHMI_GITHUB_TOKEN), nie im Browser und nie im Code.

const ADMIN_REPO = "FlohmiApp/Flohmi";
const GITHUB_FUNKTION = "github";

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
  { datei: "supabase-funktionen.yml", titel: "Edge Functions übertragen", gruppe: "wartung", symbol: "⚡",
    text: "Überträgt die Edge Function „github“ nach Supabase (läuft sonst nach Änderungen auf main)." },
  { datei: "tag-nach-merge.yml", titel: "Tag und Release nachholen", gruppe: "wartung", symbol: "🏷️",
    text: "Setzt Tag und Release für den letzten Merge nach main, falls sie fehlen." }
];

// --- Menü (Ticket #111) ------------------------------------------------------------------
// Gruppen nach Aufgaben. Jeder Bereich der Seite steht genau einmal im Menü.
// bereich: Ziel in der Adresse (#meldungen, #workflow:sammeln.yml …); github: braucht die
// GitHub-Verbindung; aktion: kein Bereich, sondern ein Knopf (Abmelden).
const MENUE_GRUPPEN = [
  // Ticket #139: Dashboard als Einstieg (am PC Startbereich, am Handy oben im Menü).
  { id: "uebersicht", titel: "Übersicht", symbol: "🏠", eintraege: [
    { bereich: "dashboard", titel: "Dashboard", symbol: "📊" }
  ] },
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
const START_BEREICH = "dashboard";

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

// Übersetzt die Fehlerantwort der Edge Function „github“ in einen verständlichen Satz.
// status: HTTP-Status der Funktion (0 = keine Verbindung), inhalt: ihre Antwort { fehler, … }.
function proxyFehlerText(status, inhalt) {
  const fehler = (inhalt && inhalt.fehler) || "";
  if (!status) return "Keine Verbindung zu Supabase. Bitte Internet prüfen.";
  if (fehler === "github") return githubFehlerText(inhalt.status, inhalt.nachricht);
  if (status === 401 || fehler === "nicht_angemeldet") return "Deine Anmeldung ist abgelaufen. Bitte abmelden und neu anmelden.";
  if (fehler === "kein_admin") return "Dieses Konto ist nicht als Admin eingetragen.";
  if (fehler === "nicht_eingerichtet") {
    return "Der GitHub-Zugang ist in Supabase noch nicht eingerichtet (Secret FLOHMI_GITHUB_TOKEN fehlt, siehe doku/ANLEITUNG-ADMIN.md).";
  }
  if (fehler === "ungueltig") return "Diese Aktion ist nicht erlaubt: " + (inhalt.nachricht || "ungültige Anfrage");
  if (status === 404) return "Die Edge Function „github“ ist noch nicht in Supabase (Workflow „Edge Functions übertragen“ starten).";
  return "Supabase meldet Fehler " + status + ".";
}

// Übersetzt eine Fehlerantwort von GitHub (über die Edge Function) in einen verständlichen Satz.
function githubFehlerText(status, nachricht) {
  const text = String(nachricht || "");
  if (status === 401) return "Das GitHub-Token in Supabase ist ungültig oder abgelaufen. Bitte erneuern (doku/ANLEITUNG-ADMIN.md).";
  if (status === 403 && /rate limit/i.test(text)) return "GitHub hat zu viele Anfragen gezählt. Bitte in ein paar Minuten noch einmal.";
  if (status === 403) return "Das GitHub-Token in Supabase hat dafür keine Rechte (nötig: Contents, Pull requests und Actions mit Schreibrechten).";
  if (status === 404) return "Nicht gefunden. Hat das GitHub-Token in Supabase Zugriff auf " + ADMIN_REPO + "?";
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

// --- Dashboard (Ticket #139) -------------------------------------------------------------
// Kennzahlen als Kacheln. Zahlen aus Supabase kommen von der Funktion admin_kennzahlen
// (Migration 20261114150000_admin_kennzahlen.sql), GitHub-Zahlen über die Edge Function.

const DASHBOARD_HOECHSTENS_SEITEN = 20; // 20 × 100 Einträge im Board reichen lange

// Zählt die Tickets einer oder mehrerer Seiten der Board-Abfrage (GraphQL) nach Status.
// Pull Requests zählen nicht mit, Tickets und Entwürfe schon. Gibt { spalten: [[Name, Anzahl]],
// gesamt } zurück; Spalten in der Reihenfolge des Boards, „ohne Status“ am Ende, falls es welche gibt.
function ticketsZaehlen(seiten) {
  let reihenfolge = [];
  const anzahl = new Map();
  for (const seite of seiten || []) {
    const projekt = seite && seite.data && seite.data.organization && seite.data.organization.projectV2;
    if (!projekt) continue;
    const optionen = projekt.field && projekt.field.options;
    if (optionen && reihenfolge.length === 0) reihenfolge = optionen.map((o) => o.name);
    for (const eintrag of projekt.items.nodes) {
      if (!eintrag || (eintrag.content && eintrag.content.__typename === "PullRequest")) continue;
      const status = (eintrag.fieldValueByName && eintrag.fieldValueByName.name) || "ohne Status";
      anzahl.set(status, (anzahl.get(status) || 0) + 1);
    }
  }
  const namen = reihenfolge.concat([...anzahl.keys()].filter((name) => !reihenfolge.includes(name)));
  const spalten = namen.map((name) => [name, anzahl.get(name) || 0]);
  return { spalten, gesamt: spalten.reduce((summe, [, zahl]) => summe + zahl, 0) };
}

// Fehler einer GraphQL-Antwort (GitHub antwortet dann trotzdem mit 200) als verständlicher Satz,
// sonst "".
function projektFehler(seite) {
  const fehler = seite && seite.errors && seite.errors[0];
  if (!fehler) {
    if (seite && seite.data && seite.data.organization && seite.data.organization.projectV2) return "";
    return "Das Board wurde nicht gefunden.";
  }
  if (/not accessible|permission|scope/i.test(fehler.message || "") || fehler.type === "FORBIDDEN") {
    return "Das GitHub-Token in Supabase darf das Board nicht lesen (nötig: Organization permissions → Projects: Read-only).";
  }
  return "GitHub meldet: " + (fehler.message || "unbekannter Fehler");
}

// Version aus dem Inhalt von package.json, sonst null.
function versionAusPaket(text) {
  try {
    const version = JSON.parse(String(text)).version;
    return /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch (fehler) {
    return null;
  }
}

// Zahl für eine Kachel: ganze Zahl ≥ 0, sonst null (dann zeigt die Kachel einen Fehler).
function kennzahl(wert) {
  return Number.isInteger(wert) && wert >= 0 ? wert : null;
}

if (typeof module !== "undefined") {
  module.exports = {
    ADMIN_REPO, GITHUB_FUNKTION, STARTBARE_WORKFLOWS, MELDUNG_SPALTEN,
    MENUE_GRUPPEN, START_BEREICH, adminMenue, menueBereiche, bereichAusAdresse,
    ARCHITEKTUR_BRANCH, ARCHITEKTUR_BILDER, ARCHITEKTUR_ERKLAERUNG, ZOOM_STUFEN, githubDateiLink, zoomAendern, zoomText,
    DIENST_SPALTEN, DIENST_FELDER, GEHEIMNIS_MUSTER, dienstPruefen, naechsteReihenfolge, dienstUnvollstaendig,
    TESTER_SPALTEN, TESTER_FELDER, testerPruefen, testerMails, testerAnzahlText,
    proxyFehlerText, githubFehlerText, prZustand, laufText, mergeFrage,
    meldungZeilen, freigabePruefen,
    DASHBOARD_HOECHSTENS_SEITEN, ticketsZaehlen, projektFehler, versionAusPaket, kennzahl
  };
}
