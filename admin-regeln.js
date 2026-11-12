// Reine Logik der Admin-Seite (Ticket #43), ohne Seite und ohne Netz, damit sie getestet
// werden kann. Angezeigt wird in admin.js. Anleitung: doku/ANLEITUNG-ADMIN.md
//
// GitHub: Die Seite spricht direkt mit der GitHub-API (sie erlaubt Anfragen aus dem Browser).
// Das Token gibt die Admin selbst ein; es bleibt nur in diesem Browser-Tab (sessionStorage)
// und ist beim Schließen des Tabs weg. Es steht nie im Code.

const ADMIN_REPO = "sarahschwarz0803-spec/Flohmi";
const GITHUB_API = "https://api.github.com";
const TOKEN_SPEICHER = "flohmi-admin-github";

// Workflows mit „Run workflow“ (workflow_dispatch). Alle laufen nur auf main.
// Ein Test prüft, dass die Liste zu .github/workflows/ passt.
const STARTBARE_WORKFLOWS = [
  { datei: "sammeln.yml", titel: "Märkte sammeln",
    text: "Holt neue Märkte und übernimmt freigegebene Meldungen in die App (läuft sonst alle 3 Stunden)." },
  { datei: "rechtliches-seiten.yml", titel: "Rechtstexte veröffentlichen",
    text: "Baut die öffentlichen Seiten zu Datenschutz, Impressum und „Konto löschen“ neu." },
  { datei: "supabase-migrationen.yml", titel: "Datenbank-Migrationen",
    text: "Überträgt neue Datenbank-Änderungen aus supabase/migrations." },
  { datei: "tag-nach-merge.yml", titel: "Tag und Release nachholen",
    text: "Setzt Tag und Release für den letzten Merge nach main, falls sie fehlen." },
  { datei: "play-store-build.yml", titel: "App Bundle für Google Play",
    text: "Baut das signierte App Bundle, wenn es zum Stand auf main ein Release gibt." }
];

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

if (typeof module !== "undefined") {
  module.exports = {
    ADMIN_REPO, GITHUB_API, TOKEN_SPEICHER, STARTBARE_WORKFLOWS, MELDUNG_SPALTEN,
    tokenPruefen, githubAnfrage, githubFehlerText, prZustand, laufText, mergeFrage,
    meldungZeilen, freigabePruefen
  };
}
