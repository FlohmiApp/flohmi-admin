// Admin-Seite (Ticket #43): Meldungen freigeben, Workflows starten, Pull Requests mergen.
// Menü nach Aufgaben (Ticket #111). Logik in admin-regeln.js, Anleitung in doku/ANLEITUNG-ADMIN.md.
//
// Schutz: Die Seite selbst ist öffentlich, ihr Code enthält keine Geheimnisse.
// - Meldungen lesen und freigeben erlaubt Supabase nur Konten aus der Tabelle „admins“
//   (Regeln in supabase/migrations/20261112170000_admins.sql).
// - GitHub geht über die Supabase Edge Function „github“ (Ticket #137): Sie prüft Anmeldung und
//   Admin-Recht und nutzt ein Token, das nur in Supabase liegt. Im Browser liegt kein GitHub-Token.
// Texte aus Meldungen kommen von fremden Personen und werden nur als Text eingesetzt (nie als HTML).
//
// Navigation: Jeder Bereich hat eine Adresse (#meldungen, #prs, #workflow:sammeln.yml …).
// So funktioniert die Zurück-Taste. Am Handy zeigt die Seite ohne Adresse das Menü, am PC
// stehen Menü und Bereich nebeneinander (dann ohne Adresse der Startbereich).

const client = supabase.createClient(SUPABASE_URL, SUPABASE_SCHLUESSEL, {
  auth: { storageKey: "flohmi-admin-anmeldung", persistSession: true, detectSessionInUrl: false }
});

const $ = (id) => document.getElementById(id);
let anmeldeEmail = "";
let githubVerbunden = false;
let istAdminAngemeldet = false;
// Bereich, zu dem es nach dem Verbinden mit GitHub weitergehen soll.
let nachDemVerbinden = null;

// --- Kleine Helfer -----------------------------------------------------------------------

function element(tag, eigenschaften = {}, ...kinder) {
  const knoten = document.createElement(tag);
  for (const [name, wert] of Object.entries(eigenschaften)) {
    if (name === "text") knoten.textContent = wert;
    else if (name === "klasse") knoten.className = wert;
    else if (name.startsWith("on")) knoten.addEventListener(name.slice(2), wert);
    else if (wert !== false && wert !== undefined) knoten.setAttribute(name, wert === true ? "" : wert);
  }
  for (const kind of kinder) if (kind) knoten.append(kind);
  return knoten;
}

function statusZeigen(text, fehler = false) {
  $("status").textContent = text || "";
  $("status").classList.toggle("fehler", Boolean(fehler));
}

async function beschaeftigt(knopf, arbeit) {
  knopf.disabled = true;
  try { return await arbeit(); } finally { knopf.disabled = false; }
}

// --- Menü und Bereiche (Ticket #111) -------------------------------------------------------

function menueZeichnen() {
  $("menue").replaceChildren(...adminMenue().map(function (gruppe) {
    const ueberschrift = "menue-" + gruppe.id;
    return element("section", { klasse: "menue-gruppe", "aria-labelledby": ueberschrift },
      element("h2", { id: ueberschrift },
        element("span", { klasse: "symbol", "aria-hidden": "true", text: gruppe.symbol }), gruppe.titel),
      element("ul", {}, ...gruppe.eintraege.map(function (eintrag) {
        const inhalt = [
          element("span", { klasse: "symbol", "aria-hidden": "true", text: eintrag.symbol }),
          element("span", { klasse: "titel", text: eintrag.titel }),
          element("span", { klasse: "zaehler", hidden: true })
        ];
        if (eintrag.aktion === "abmelden") {
          return element("li", {}, element("button", { klasse: "menue-eintrag", type: "button",
            "data-aktion": "abmelden", onclick: abmelden }, ...inhalt));
        }
        return element("li", {}, element("a", { klasse: "menue-eintrag", href: "#" + eintrag.bereich,
          "data-bereich": eintrag.bereich }, ...inhalt));
      })));
  }));
}

// Zahl hinter einem Menüeintrag (offene Meldungen, Pull Requests …). null blendet sie aus.
function zaehlerSetzen(bereich, anzahl) {
  const zaehler = document.querySelector(`.menue-eintrag[data-bereich="${bereich}"] .zaehler`);
  if (!zaehler) return;
  zaehler.hidden = !anzahl;
  zaehler.textContent = anzahl ? String(anzahl) : "";
}

// Zeigt den Bereich aus der Adresse. Ohne gültige Adresse: am Handy das Menü, am PC den Start.
function bereichZeigen() {
  if (!istAdminAngemeldet) return;
  let eintrag = bereichAusAdresse(location.hash);
  const amHandy = window.matchMedia("(max-width: 899px)").matches;
  $("verwaltung").classList.toggle("zeigt-menue", !eintrag);
  if (!eintrag) {
    if (amHandy) {
      for (const bereich of document.querySelectorAll(".bereich")) bereich.hidden = true;
      menueMarkieren(null);
      return;
    }
    eintrag = bereichAusAdresse("#" + START_BEREICH);
  }

  // Ohne GitHub-Verbindung geht es erst zur Verbindung, danach weiter zum gewünschten Bereich.
  let ziel = eintrag;
  $("github-hinweis").hidden = true;
  if (eintrag.github && !githubVerbunden) {
    nachDemVerbinden = eintrag.bereich;
    $("github-hinweis").textContent = "„" + eintrag.titel + "“ braucht die GitHub-Verbindung. " +
      "Sie wird gerade geprüft oder ist noch nicht eingerichtet.";
    $("github-hinweis").hidden = false;
    ziel = bereichAusAdresse("#github");
  }

  const sichtbar = ziel.workflow ? "workflow" : ziel.bereich;
  for (const bereich of document.querySelectorAll(".bereich")) {
    bereich.hidden = bereich.dataset.bereich !== sichtbar;
  }
  if (ziel.workflow) {
    $("workflow-titel").textContent = ziel.symbol + " " + ziel.titel;
    for (const karte of document.querySelectorAll("#workflow-liste [data-workflow]")) {
      karte.hidden = karte.dataset.workflow !== ziel.workflow;
    }
  }
  menueMarkieren(eintrag.bereich);
  document.title = eintrag.titel + " – Flohmi Admin";
  if (ziel.bereich === "architektur") architekturZeigen();
}

function menueMarkieren(bereich) {
  for (const link of document.querySelectorAll(".menue-eintrag[data-bereich]")) {
    if (link.dataset.bereich === bereich) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

window.addEventListener("hashchange", function () {
  statusZeigen("");
  bereichZeigen();
  // Am Handy nach oben, damit der neue Bereich (oder das Menü) sichtbar ist.
  window.scrollTo(0, 0);
});
window.matchMedia("(max-width: 899px)").addEventListener("change", bereichZeigen);

// --- Anmeldung (Supabase) ----------------------------------------------------------------

$("email-formular").addEventListener("submit", async function (ereignis) {
  ereignis.preventDefault();
  const email = this.elements.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return statusZeigen("Bitte eine gültige E-Mail-Adresse eingeben.", true);
  anmeldeEmail = email;
  await beschaeftigt(this.querySelector("button"), async () => {
    // Keine neuen Konten über die Admin-Seite: Admins haben schon ein Flohmi-Konto.
    const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) return statusZeigen("Code konnte nicht geschickt werden: " + error.message, true);
    statusZeigen("Code an " + email + " geschickt.");
    $("email-formular").hidden = true;
    $("code-formular").hidden = false;
    $("code").focus();
  });
});

$("code-formular").addEventListener("submit", async function (ereignis) {
  ereignis.preventDefault();
  const code = this.elements.code.value.replace(/\s/g, "");
  await beschaeftigt(this.querySelector("button"), async () => {
    const { error } = await client.auth.verifyOtp({ email: anmeldeEmail, token: code, type: "email" });
    if (error) return statusZeigen("Der Code stimmt nicht oder ist abgelaufen.", true);
    statusZeigen("");
  });
});

// Seite leeren, wenn niemand (mehr) angemeldet ist.
function verwaltungLeeren() {
  istAdminAngemeldet = false;
  githubTrennen();
  // Personenbezogene Daten (Ticket #122) nicht im ausgeblendeten Teil der Seite lassen.
  tester = [];
  $("tester-liste").replaceChildren();
}

// Ticket #144: nur dieses Gerät abmelden. Der Standard („global“) meldet alle Tabs und Geräte
// ab; deren Anmeldung wird ungültig.
async function abmelden() {
  await client.auth.signOut({ scope: "local" });
  verwaltungLeeren();
  history.replaceState(null, "", location.pathname + location.search);
  statusZeigen("Abgemeldet.");
}
$("kein-admin-abmelden").addEventListener("click", abmelden);

// Ticket #144: Konto der zuletzt verarbeiteten Anmeldung (undefined = noch nichts verarbeitet)
// und eine laufende Nummer, damit eine ältere, noch laufende Prüfung nichts mehr anzeigt.
let verarbeitetesKonto;
let pruefungNummer = 0;

function anmeldungVerarbeiten(sitzung) {
  const schritt = anmeldungSchritt(verarbeitetesKonto, sitzung);
  verarbeitetesKonto = schritt.konto;
  if (schritt.aktion === "nichts") return; // gleiche Person: kein Neuladen, keine Schleife
  anmeldungAnzeigen(sitzung);
}

async function anmeldungAnzeigen(sitzung) {
  const nummer = ++pruefungNummer;
  const angemeldet = Boolean(sitzung);
  istAdminAngemeldet = false;
  $("anmeldung").hidden = angemeldet;
  $("kein-admin").hidden = true;
  $("verwaltung").hidden = true;
  if (!angemeldet) {
    verwaltungLeeren();
    $("email-formular").hidden = false;
    $("code-formular").hidden = true;
    return;
  }
  const ergebnis = adminErgebnis(await client.rpc("ist_admin"));
  if (nummer !== pruefungNummer) return; // inzwischen neu angemeldet oder abgemeldet
  if (ergebnis === "abgelaufen") {
    // Anmeldung ungültig (z. B. in einem anderen Tab abgemeldet): lokal abmelden und das sagen.
    // verarbeitetesKonto zuerst auf „abgemeldet“, damit das folgende SIGNED_OUT nichts auslöst.
    verarbeitetesKonto = null;
    verwaltungLeeren();
    $("anmeldung").hidden = false;
    $("email-formular").hidden = false;
    $("code-formular").hidden = true;
    statusZeigen(ANMELDUNG_ABGELAUFEN, true);
    await client.auth.signOut({ scope: "local" });
    return;
  }
  if (ergebnis === "kein_admin") {
    $("kein-admin").hidden = false;
    return;
  }
  istAdminAngemeldet = true;
  $("verwaltung").hidden = false;
  menueZeichnen();
  bereichZeigen();
  meldungenLaden();
  diensteLaden();
  testerLaden();
  zeitplaeneLaden();
  dashboardSupabaseLaden();
  githubVerbinden();
}

client.auth.onAuthStateChange(function (ereignis, sitzung) {
  // Nicht direkt im Rückruf auf Supabase warten (sonst kann die Bibliothek hängen bleiben).
  setTimeout(() => anmeldungVerarbeiten(sitzung), 0);
});

// --- Zeitpläne (Ticket #138) -------------------------------------------------------------
// Tabelle admin_zeitplaene in Supabase (nur Admins). Supabase (pg_cron) startet fällige
// Workflows selbst; hier wird nur eingestellt und angezeigt.

function zeitText(datum) {
  return datum ? new Date(datum).toLocaleString("de-DE", { timeZone: "Europe/Berlin",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";
}

async function zeitplaeneLaden() {
  const liste = $("zeitplaene-liste");
  liste.replaceChildren(element("p", { klasse: "hinweis", text: "Lädt …" }));
  let { data: zeilen, error } = await client.from("admin_zeitplaene").select(ZEITPLAN_SPALTEN).order("workflow");
  if (error) {
    liste.replaceChildren(element("p", { klasse: "warnung", text: "Zeitpläne konnten nicht geladen werden: " + error.message }));
    return;
  }
  // Neue zeitgesteuerte Workflows bekommen von selbst ihren Standard-Zeitplan.
  const fehlend = fehlendeZeitplaene(zeilen);
  if (fehlend.length) {
    const { error: anlegen } = await client.from("admin_zeitplaene").upsert(fehlend, { onConflict: "workflow", ignoreDuplicates: true });
    if (anlegen) statusZeigen("Standard-Zeitplan nicht angelegt: " + anlegen.message, true);
    else ({ data: zeilen } = await client.from("admin_zeitplaene").select(ZEITPLAN_SPALTEN).order("workflow"));
  }
  // Zeitgeber eingerichtet? Und wie ging der letzte automatische Start aus?
  const { data: stand } = await client.rpc("admin_zeitplan_status");
  const zeitgeber = $("zeitplaene-zeitgeber");
  zeitgeber.hidden = !stand || stand.token_vorhanden;
  zeitgeber.textContent = "Der Zeitgeber startet noch nichts: Im Supabase Vault fehlt das Secret " +
    "„flohmi_github_token“ (siehe doku/ANLEITUNG-ADMIN.md, Zeitpläne).";
  const laeufe = (stand && stand.laeufe) || {};
  liste.replaceChildren(...(zeilen || []).map((zeile) => zeitplanAnzeigen(zeile, laeufe[zeile.workflow])));
  if (!zeilen || zeilen.length === 0) liste.replaceChildren(element("p", { klasse: "hinweis", text: "Keine zeitgesteuerten Workflows." }));
}

function zeitplanAnzeigen(zeile, lauf) {
  const workflow = STARTBARE_WORKFLOWS.find((w) => w.datei === zeile.workflow);
  const titel = workflow ? workflow.symbol + " " + workflow.titel : zeile.workflow;
  const id = (name) => "zeitplan-" + zeile.workflow.replace(/\W/g, "-") + "-" + name;
  const fehlerStunden = element("p", { klasse: "feldfehler", hidden: true });
  const fehlerMinute = element("p", { klasse: "feldfehler", hidden: true });
  const formular = element("form", { klasse: "zeitplan-formular", novalidate: true },
    element("label", { klasse: "schalter", for: id("aktiv") },
      element("input", { id: id("aktiv"), name: "aktiv", type: "checkbox", checked: zeile.aktiv }), "Aktiv"),
    element("label", { for: id("stunden") }, "Alle … Stunden",
      element("input", { id: id("stunden"), name: "intervall_stunden", type: "number", min: "1", max: "168", step: "1",
        inputmode: "numeric", value: String(zeile.intervall_stunden) })),
    element("label", { for: id("minute") }, "zur Minute",
      element("input", { id: id("minute"), name: "minute", type: "number", min: "0", max: "59", step: "1",
        inputmode: "numeric", value: String(zeile.minute) })),
    element("div", { klasse: "knoepfe" },
      element("button", { klasse: "knopf", type: "submit", text: "Speichern" }),
      element("button", { klasse: "knopf knopf-leise", type: "button", text: "Jetzt starten",
        onclick: (e) => zeitplanJetztStarten(zeile, titel, e.currentTarget) })));
  formular.addEventListener("submit", (ereignis) => {
    ereignis.preventDefault();
    zeitplanSpeichern(zeile, formular, fehlerStunden, fehlerMinute);
  });
  const naechster = naechsterLauf(zeile);
  return element("article", { klasse: "eintrag", "data-zeitplan": zeile.workflow },
    element("h3", { text: titel }),
    element("p", { klasse: "hinweis", text: "Jetzt: " + zeitplanText(zeile) +
      " · Nächster Lauf: " + (naechster ? zeitText(naechster) : "keiner (pausiert)") }),
    formular, fehlerStunden, fehlerMinute,
    element("p", { klasse: "hinweis", text: "Letzter automatischer Start: " + zeitText(zeile.zuletzt_gestartet) +
      (zeile.zuletzt_gestartet ? " – " + laufStatusText(lauf) : "") }));
}

async function zeitplanSpeichern(zeile, formular, fehlerStunden, fehlerMinute) {
  const { werte, fehler } = zeitplanPruefen({ aktiv: formular.elements.aktiv.checked,
    intervall_stunden: formular.elements.intervall_stunden.value, minute: formular.elements.minute.value });
  for (const [feld, absatz] of [["intervall_stunden", fehlerStunden], ["minute", fehlerMinute]]) {
    absatz.textContent = fehler[feld] || "";
    absatz.hidden = !fehler[feld];
  }
  if (Object.keys(fehler).length > 0) return statusZeigen("Nicht gespeichert: Bitte die Eingaben prüfen.", true);
  await beschaeftigt(formular.querySelector("button[type=submit]"), async () => {
    const { error } = await client.from("admin_zeitplaene")
      .update({ ...werte, geaendert_am: new Date().toISOString() }).eq("workflow", zeile.workflow);
    if (error) return statusZeigen("Nicht gespeichert: " + error.message, true);
    statusZeigen("Zeitplan gespeichert: " + zeitplanText(werte) + ".");
    zeitplaeneLaden();
  });
}

async function zeitplanJetztStarten(zeile, titel, knopf) {
  if (!window.confirm("„" + titel + "“ jetzt starten (auf main)?")) return;
  await beschaeftigt(knopf, async () => {
    try {
      await github("workflowStarten", { datei: zeile.workflow });
      statusZeigen("„" + titel + "“ gestartet. Ergebnis unter Actions bei GitHub.");
    } catch (fehler) {
      statusZeigen("Nicht gestartet: " + fehler.message, true);
    }
  });
}

$("zeitplaene-laden").addEventListener("click", zeitplaeneLaden);

// --- Dashboard (Ticket #139) -------------------------------------------------------------
// Jede Kachel lädt für sich. Schlägt eine fehl, zeigt nur sie eine Meldung.

function kachelSetzen(name, ...inhalt) {
  // Leere Teile (z. B. kein Link) weglassen, sonst stünde dort „null“.
  document.querySelector(`.kachel[data-kennzahl="${name}"] .kachel-inhalt`).replaceChildren(...inhalt.filter(Boolean));
}

function kachelFehler(name, text) {
  kachelSetzen(name, element("p", { klasse: "warnung", text: text }));
}

function kachelZahl(name, zahl, link) {
  kachelSetzen(name, element("p", { klasse: "zahl", text: String(zahl) }),
    link ? element("a", { href: link.ziel, text: link.text }) : null);
}

// Märkte zur Freigabe, Tester und registrierte User: eine Abfrage bei Supabase, nur Zahlen.
async function dashboardSupabaseLaden() {
  for (const name of ["meldungen", "tester", "nutzer"]) kachelSetzen(name, element("p", { klasse: "hinweis", text: "Lädt …" }));
  const { data, error } = await client.rpc("admin_kennzahlen");
  const zahlen = error ? {} : (data || {});
  const fehler = error ? "Nicht geladen: " + error.message : "Keine Zahl erhalten.";
  const kacheln = [
    ["meldungen", zahlen.offene_meldungen, { ziel: "#meldungen", text: "Zu den Meldungen" }],
    ["tester", zahlen.tester, { ziel: "#tester", text: "Zur Testerdatenbank" }],
    ["nutzer", zahlen.nutzer, null]
  ];
  for (const [name, wert, link] of kacheln) {
    if (kennzahl(wert) === null) kachelFehler(name, fehler);
    else kachelZahl(name, wert, link);
  }
}

// Tickets nach Status und Versionen: über die Edge Function „github“.
async function dashboardGithubLaden() {
  if (!githubVerbunden) {
    for (const name of ["tickets", "version"]) {
      kachelFehler(name, "Braucht die GitHub-Verbindung (siehe „Verbindung → GitHub-Verbindung“).");
    }
    return;
  }
  for (const name of ["tickets", "version"]) kachelSetzen(name, element("p", { klasse: "hinweis", text: "Lädt …" }));
  ticketsLaden();
  versionenLaden();
}

async function ticketsLaden() {
  try {
    const seiten = [];
    let nach = null;
    for (let seite = 0; seite < DASHBOARD_HOECHSTENS_SEITEN; seite++) {
      const antwort = await github("projektStatus", { nach });
      const fehler = projektFehler(antwort);
      if (fehler) return kachelFehler("tickets", fehler);
      seiten.push(antwort);
      const info = antwort.data.organization.projectV2.items.pageInfo;
      if (!info.hasNextPage) break;
      nach = info.endCursor;
    }
    const { spalten, gesamt } = ticketsZaehlen(seiten);
    kachelSetzen("tickets",
      element("ul", { klasse: "status-liste" }, ...spalten.map(([name, zahl]) =>
        element("li", { "data-status": name }, element("span", { klasse: "zahl", text: String(zahl) }),
          element("span", { klasse: "name", text: name })))),
      element("p", { klasse: "hinweis", text: gesamt + " Tickets insgesamt (ohne Pull Requests)" }));
  } catch (fehler) {
    kachelFehler("tickets", fehler.message);
  }
}

async function versionenLaden() {
  const zeilen = element("dl");
  for (const branch of ["develop", "main"]) {
    let wert;
    try {
      wert = versionAusPaket(await github("paketVersion", { ref: branch })) || "nicht lesbar";
    } catch (fehler) {
      wert = fehler.message;
    }
    zeilen.append(element("dt", { text: branch }), element("dd", { "data-branch": branch, text: wert }));
  }
  kachelSetzen("version", zeilen);
}

$("dashboard-laden").addEventListener("click", function () {
  dashboardSupabaseLaden();
  dashboardGithubLaden();
});

// --- Meldungen ---------------------------------------------------------------------------

async function meldungenLaden() {
  const liste = $("meldungen-liste");
  liste.replaceChildren(element("p", { klasse: "hinweis", text: "Lädt …" }));
  const { data, error } = await client.from("meldungen").select(MELDUNG_SPALTEN)
    .eq("status", "offen").order("datum", { ascending: true });
  if (error) {
    liste.replaceChildren(element("p", { klasse: "warnung", text: "Meldungen konnten nicht geladen werden: " + error.message }));
    return;
  }
  zaehlerSetzen("meldungen", data.length);
  if (data.length === 0) {
    liste.replaceChildren(element("p", { klasse: "hinweis", text: "Keine offenen Meldungen." }));
    return;
  }
  liste.replaceChildren(...data.map(meldungAnzeigen));
}

function meldungAnzeigen(meldung) {
  const daten = element("dl");
  for (const [name, wert] of meldungZeilen(meldung)) {
    daten.append(element("dt", { text: name }), element("dd", { text: String(wert) }));
  }
  const grund = freigabePruefen(meldung);
  const eintrag = element("article", { klasse: "eintrag", "data-id": String(meldung.id) },
    element("h3", { text: meldung.name + " (" + meldung.ort + ")" }),
    daten,
    grund ? element("p", { klasse: "warnung", text: "Nicht freigeben: " + grund }) : null,
    element("div", { klasse: "knoepfe" },
      element("button", { klasse: "knopf", type: "button", disabled: Boolean(grund), text: "Freigeben",
        onclick: (e) => statusSetzen(meldung, "freigegeben", e.currentTarget, eintrag) }),
      element("button", { klasse: "knopf knopf-warnung", type: "button", text: "Ablehnen",
        onclick: (e) => statusSetzen(meldung, "abgelehnt", e.currentTarget, eintrag) })));
  return eintrag;
}

async function statusSetzen(meldung, status, knopf, eintrag) {
  const wort = status === "freigegeben" ? "freigeben" : "ablehnen";
  if (!window.confirm("Meldung „" + meldung.name + "“ wirklich " + wort + "?")) return;
  await beschaeftigt(knopf, async () => {
    // Nur wenn sie noch offen ist (falls jemand anderes schneller war).
    const { data, error } = await client.from("meldungen").update({ status })
      .eq("id", meldung.id).eq("status", "offen").select("id");
    if (error) return statusZeigen("Nicht gespeichert: " + error.message, true);
    if (!data || data.length === 0) return statusZeigen("Die Meldung war nicht mehr offen. Liste neu laden.", true);
    eintrag.remove();
    statusZeigen("„" + meldung.name + "“ " + (status === "freigegeben" ? "freigegeben." : "abgelehnt."));
    const uebrig = $("meldungen-liste").children.length;
    zaehlerSetzen("meldungen", uebrig);
    if (uebrig === 0) meldungenLaden();
  });
}

$("meldungen-laden").addEventListener("click", meldungenLaden);

// --- Architektur und Workflows (Ticket #113) ----------------------------------------------
// Die Bilder kommen über die Edge Function „github“ aus dem privaten Repository. Angezeigt werden sie als
// <img> mit einer Blob-Adresse: So läuft im SVG kein Code, und Zoom geht über die Breite.

const architekturCache = new Map();
let architekturAktiv = ARCHITEKTUR_BILDER[0].datei;
let architekturZoom = null;

function architekturReiterZeichnen() {
  $("architektur-reiter").replaceChildren(...ARCHITEKTUR_BILDER.map((bild) =>
    element("button", { klasse: "reiter-knopf", type: "button", role: "tab", "data-datei": bild.datei,
      "aria-selected": String(bild.datei === architekturAktiv), text: bild.titel,
      onclick: () => { architekturAktiv = bild.datei; architekturZeigen(); } })));
}

function architekturZoomAnwenden() {
  const bild = $("architektur-bild");
  bild.style.width = architekturZoom === null ? "100%" : Math.round((bild.naturalWidth || 1200) * architekturZoom) + "px";
  bild.style.maxWidth = architekturZoom === null ? "100%" : "none";
  $("zoom-stufe").textContent = zoomText(architekturZoom);
}

async function architekturZeigen() {
  if (!githubVerbunden) return;
  architekturReiterZeichnen();
  $("architektur-quelle").textContent = "Stand: Branch „" + ARCHITEKTUR_BRANCH + "“ in " + ADMIN_REPO +
    ", Ordner doku/architektur/. Die Bilder werden bei Änderungen an Diensten und Workflows mit angepasst.";
  $("architektur-erklaerung").href = githubDateiLink(ARCHITEKTUR_ERKLAERUNG);
  const bild = $("architektur-bild");
  const status = $("architektur-status");
  const datei = architekturAktiv;
  bild.alt = ARCHITEKTUR_BILDER.find((b) => b.datei === datei).titel;
  try {
    if (!architekturCache.has(datei)) {
      status.textContent = "Lädt …";
      status.hidden = false;
      bild.hidden = true;
      const svg = await github("datei", { pfad: datei, ref: ARCHITEKTUR_BRANCH });
      architekturCache.set(datei, URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
    }
    if (architekturAktiv !== datei) return; // Inzwischen anderer Reiter gewählt.
    bild.onload = architekturZoomAnwenden;
    bild.src = architekturCache.get(datei);
    $("architektur-neuer-tab").href = architekturCache.get(datei);
    bild.hidden = false;
    status.hidden = true;
    architekturZoomAnwenden();
  } catch (fehler) {
    bild.hidden = true;
    status.hidden = false;
    status.textContent = "Bild konnte nicht geladen werden: " + fehler.message;
  }
}

$("zoom-groesser").addEventListener("click", () => { architekturZoom = zoomAendern(architekturZoom, +1); architekturZoomAnwenden(); });
$("zoom-kleiner").addEventListener("click", () => { architekturZoom = zoomAendern(architekturZoom, -1); architekturZoomAnwenden(); });
$("zoom-einpassen").addEventListener("click", () => { architekturZoom = null; architekturZoomAnwenden(); });

// --- Dienste und Zugänge (Ticket #77) ------------------------------------------------------
// Tabelle „admin_dienste“ in Supabase: lesen und ändern nur für Admins.

let dienste = [];
let dienstInBearbeitung = null;

async function diensteLaden() {
  const liste = $("dienste-liste");
  liste.replaceChildren(element("p", { klasse: "hinweis", text: "Lädt …" }));
  const { data, error } = await client.from("admin_dienste").select(DIENST_SPALTEN)
    .order("reihenfolge", { ascending: true }).order("id", { ascending: true });
  if (error) {
    liste.replaceChildren(element("p", { klasse: "warnung", text: "Dienste konnten nicht geladen werden: " + error.message }));
    return;
  }
  dienste = data;
  zaehlerSetzen("dienste", data.filter(dienstUnvollstaendig).length);
  if (data.length === 0) {
    liste.replaceChildren(element("p", { klasse: "hinweis", text: "Noch keine Dienste eingetragen." }));
    return;
  }
  liste.replaceChildren(...data.map(dienstAnzeigen));
}

function dienstAnzeigen(dienst) {
  // Nur echte https-Adressen werden zum Link (die Datenbank lässt ohnehin nichts anderes zu).
  const titel = /^https:\/\/\S+$/.test(String(dienst.link || ""))
    ? element("a", { href: dienst.link, target: "_blank", rel: "noopener noreferrer", text: dienst.dienst })
    : dienst.dienst;
  const daten = element("dl");
  for (const [name, wert] of [["Wofür", dienst.zweck], ["Konto", dienst.konto], ["Hinweis", dienst.hinweis]]) {
    if (wert) daten.append(element("dt", { text: name }), element("dd", { text: wert }));
  }
  return element("article", { klasse: "eintrag dienst", "data-dienst": String(dienst.id) },
    element("h3", {}, titel),
    daten.children.length ? daten : null,
    dienstUnvollstaendig(dienst) ? element("p", { klasse: "warnung", text: "Konto noch ergänzen." }) : null,
    element("div", { klasse: "knoepfe" },
      element("button", { klasse: "knopf knopf-leise", type: "button", text: "Bearbeiten",
        onclick: () => dienstFormularOeffnen(dienst) }),
      element("button", { klasse: "knopf knopf-leise knopf-warnung", type: "button", text: "Löschen",
        onclick: (e) => dienstLoeschen(dienst, e.currentTarget) })));
}

function dienstFehlerZeigen(fehler) {
  for (const feld of document.querySelectorAll("#dienst-formular [data-fehler]")) {
    const text = fehler[feld.dataset.fehler] || "";
    feld.textContent = text;
    feld.hidden = !text;
  }
}

function dienstFormularOeffnen(dienst = null) {
  const formular = $("dienst-formular");
  dienstInBearbeitung = dienst;
  $("dienst-formular-titel").textContent = dienst ? "„" + dienst.dienst + "“ bearbeiten" : "Dienst hinzufügen";
  for (const feld of Object.keys(DIENST_FELDER)) formular.elements[feld].value = (dienst && dienst[feld]) || "";
  dienstFehlerZeigen({});
  formular.hidden = false;
  formular.elements.dienst.focus();
}

function dienstFormularSchliessen() {
  $("dienst-formular").hidden = true;
  dienstInBearbeitung = null;
}

$("dienst-neu").addEventListener("click", () => dienstFormularOeffnen());
$("dienst-abbrechen").addEventListener("click", dienstFormularSchliessen);

$("dienst-formular").addEventListener("submit", async function (ereignis) {
  ereignis.preventDefault();
  const eingabe = Object.fromEntries(Object.keys(DIENST_FELDER).map((feld) => [feld, this.elements[feld].value]));
  const { werte, fehler } = dienstPruefen(eingabe);
  dienstFehlerZeigen(fehler);
  if (Object.keys(fehler).length > 0) return;
  await beschaeftigt(this.querySelector("button[type=submit]"), async () => {
    const anfrage = dienstInBearbeitung
      ? client.from("admin_dienste").update({ ...werte, geaendert_am: new Date().toISOString() }).eq("id", dienstInBearbeitung.id)
      : client.from("admin_dienste").insert({ ...werte, reihenfolge: naechsteReihenfolge(dienste) });
    const { error } = await anfrage;
    if (error) return statusZeigen("Nicht gespeichert: " + error.message, true);
    statusZeigen("„" + werte.dienst + "“ gespeichert.");
    dienstFormularSchliessen();
    diensteLaden();
  });
});

async function dienstLoeschen(dienst, knopf) {
  if (!window.confirm("„" + dienst.dienst + "“ wirklich aus der Liste löschen?")) return;
  await beschaeftigt(knopf, async () => {
    const { error } = await client.from("admin_dienste").delete().eq("id", dienst.id);
    if (error) return statusZeigen("Nicht gelöscht: " + error.message, true);
    statusZeigen("„" + dienst.dienst + "“ gelöscht.");
    diensteLaden();
  });
}

// --- Testerinnen und Tester (Ticket #122) --------------------------------------------------
// Tabelle „admin_tester“ in Supabase: lesen und ändern nur für Admins.
// Alle Texte nur per textContent (über element()), nie als HTML.

let tester = [];
let testerInBearbeitung = null;

async function testerLaden() {
  const liste = $("tester-liste");
  const tabelle = $("tester-tabelle");
  $("tester-anzahl").textContent = "Lädt …";
  const { data, error } = await client.from("admin_tester").select(TESTER_SPALTEN)
    .order("name", { ascending: true }).order("id", { ascending: true });
  if (error) {
    $("tester-anzahl").textContent = "Liste konnte nicht geladen werden: " + error.message;
    tabelle.hidden = true;
    return;
  }
  tester = data;
  $("tester-mails-kopieren").hidden = !testerMails(data);
  if (data.length === 0) {
    $("tester-anzahl").textContent = "Noch niemand eingetragen. Mit „+ Person hinzufügen“ legst du die erste Zeile an.";
    tabelle.hidden = true;
    liste.replaceChildren();
    return;
  }
  $("tester-anzahl").textContent = testerAnzahlText(data.length);
  liste.replaceChildren(...data.map(testerZeile));
  tabelle.hidden = false;
}

function testerZeile(person) {
  return element("tr", { "data-tester": String(person.id) },
    element("td", { text: person.name }),
    element("td", { text: person.telefon || "–" }),
    element("td", { text: person.google_mail || "–" }),
    element("td", {}, element("div", { klasse: "knoepfe" },
      element("button", { klasse: "knopf knopf-leise", type: "button", text: "Bearbeiten",
        onclick: () => testerFormularOeffnen(person) }),
      element("button", { klasse: "knopf knopf-leise knopf-warnung", type: "button", text: "Löschen",
        onclick: (e) => testerLoeschen(person, e.currentTarget) }))));
}

function testerFehlerZeigen(fehler) {
  for (const feld of document.querySelectorAll("#tester-formular [data-fehler]")) {
    const text = fehler[feld.dataset.fehler] || "";
    feld.textContent = text;
    feld.hidden = !text;
  }
}

function testerFormularOeffnen(person = null) {
  const formular = $("tester-formular");
  testerInBearbeitung = person;
  $("tester-formular-titel").textContent = person ? "„" + person.name + "“ bearbeiten" : "Person hinzufügen";
  for (const feld of Object.keys(TESTER_FELDER)) formular.elements[feld].value = (person && person[feld]) || "";
  testerFehlerZeigen({});
  formular.hidden = false;
  formular.elements.name.focus();
}

function testerFormularSchliessen() {
  $("tester-formular").hidden = true;
  testerInBearbeitung = null;
}

$("tester-neu").addEventListener("click", () => testerFormularOeffnen());
$("tester-abbrechen").addEventListener("click", testerFormularSchliessen);

$("tester-formular").addEventListener("submit", async function (ereignis) {
  ereignis.preventDefault();
  const eingabe = Object.fromEntries(Object.keys(TESTER_FELDER).map((feld) => [feld, this.elements[feld].value]));
  const { werte, fehler } = testerPruefen(eingabe);
  testerFehlerZeigen(fehler);
  if (Object.keys(fehler).length > 0) return;
  await beschaeftigt(this.querySelector("button[type=submit]"), async () => {
    const anfrage = testerInBearbeitung
      ? client.from("admin_tester").update({ ...werte, geaendert_am: new Date().toISOString() }).eq("id", testerInBearbeitung.id)
      : client.from("admin_tester").insert(werte);
    const { error } = await anfrage;
    if (error) return statusZeigen("Nicht gespeichert: " + error.message, true);
    statusZeigen("„" + werte.name + "“ gespeichert.");
    testerFormularSchliessen();
    testerLaden();
  });
});

async function testerLoeschen(person, knopf) {
  if (!window.confirm("„" + person.name + "“ wirklich aus der Testerliste löschen?")) return;
  await beschaeftigt(knopf, async () => {
    const { error } = await client.from("admin_tester").delete().eq("id", person.id);
    if (error) return statusZeigen("Nicht gelöscht: " + error.message, true);
    statusZeigen("„" + person.name + "“ gelöscht.");
    testerLaden();
  });
}

// Für die Play Console: alle Google-Mails mit Komma getrennt in die Zwischenablage.
$("tester-mails-kopieren").addEventListener("click", async function () {
  const mails = testerMails(tester);
  try {
    await navigator.clipboard.writeText(mails);
    statusZeigen("Google-Mails kopiert. In der Play Console bei „Tester“ in die E-Mail-Liste einfügen.");
  } catch {
    window.prompt("Kopieren ging nicht automatisch. Bitte hier markieren und kopieren:", mails);
  }
});

// --- GitHub ------------------------------------------------------------------------------

// Eine GitHub-Aktion über die Edge Function „github“ (Ticket #137). Mitgeschickt wird nur,
// was passieren soll ({ art, werte }) und das Zugangs-Token der Supabase-Anmeldung.
async function github(art, werte = {}) {
  const { data } = await client.auth.getSession();
  const sitzung = data && data.session;
  if (!sitzung) throw new Error(proxyFehlerText(401, { fehler: "nicht_angemeldet" }));
  let antwort;
  try {
    antwort = await fetch(SUPABASE_URL + "/functions/v1/" + GITHUB_FUNKTION, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SCHLUESSEL,
        "Authorization": "Bearer " + sitzung.access_token
      },
      body: JSON.stringify({ art, werte })
    });
  } catch (fehler) {
    throw new Error(proxyFehlerText(0));
  }
  let inhalt = null;
  try { inhalt = await antwort.json(); } catch (fehler) { /* keine Details */ }
  if (!antwort.ok) throw new Error(proxyFehlerText(antwort.status, inhalt));
  return inhalt ? inhalt.daten : null;
}

function githubTrennen() {
  githubVerbunden = false;
  $("github-stand").textContent = "Nicht verbunden.";
  for (const bereich of ["prs", "main"]) zaehlerSetzen(bereich, null);
  // Über GitHub geholte Bilder (Ticket #113) wieder vergessen.
  for (const adresse of architekturCache.values()) URL.revokeObjectURL(adresse);
  architekturCache.clear();
  $("architektur-bild").removeAttribute("src");
  $("architektur-bild").hidden = true;
}

$("github-pruefen").addEventListener("click", (e) => beschaeftigt(e.currentTarget, githubVerbinden));

// Prüft nach der Anmeldung von selbst, ob die Edge Function GitHub erreicht und schreiben darf.
async function githubVerbinden() {
  $("github-stand").textContent = "Prüfe die Verbindung …";
  try {
    const [nutzer, repo] = await Promise.all([github("ich"), github("repo")]);
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error("Das GitHub-Token in Supabase (Konto " + nutzer.login + ") darf in " + ADMIN_REPO + " nicht schreiben.");
    }
    githubVerbunden = true;
    $("github-stand").textContent = "Verbunden mit " + ADMIN_REPO + " über Supabase (Token von " + nutzer.login + ").";
    $("github-hinweis").hidden = true;
    statusZeigen("");
    workflowsAnzeigen();
    prsLaden();
    mainBereichLaden();
    dashboardGithubLaden();
    // Wollte die Admin eigentlich woanders hin, geht es jetzt dorthin.
    if (nachDemVerbinden) {
      const ziel = nachDemVerbinden;
      nachDemVerbinden = null;
      if (location.hash === "#" + ziel) bereichZeigen(); else location.hash = ziel;
    } else {
      bereichZeigen();
    }
  } catch (fehler) {
    githubTrennen();
    $("github-stand").textContent = "Nicht verbunden: " + fehler.message;
    dashboardGithubLaden();
    statusZeigen(fehler.message, true);
  }
}

// Workflows: je Workflow eine Karte; sichtbar ist immer nur die aus dem Menü gewählte.
function workflowsAnzeigen() {
  $("workflow-liste").replaceChildren(...STARTBARE_WORKFLOWS.map(function (workflow) {
    const stand = element("p", { klasse: "hinweis", text: "Letzter Lauf: …" });
    const eintrag = element("div", { klasse: "eintrag", "data-workflow": workflow.datei, hidden: true },
      element("p", { text: workflow.text }),
      stand,
      element("div", { klasse: "knoepfe" },
        element("button", { klasse: "knopf", type: "button", text: "Starten",
          onclick: (e) => workflowStarten(workflow, e.currentTarget, stand) })));
    laufZeigen(workflow, stand);
    return eintrag;
  }));
}

async function laufZeigen(workflow, stand) {
  try {
    const { workflow_runs: laeufe } = await github("letzteLaeufe", { datei: workflow.datei });
    stand.textContent = "Letzter Lauf: " + laufText(laeufe[0]);
  } catch (fehler) {
    stand.textContent = "Letzter Lauf: " + fehler.message;
  }
}

async function workflowStarten(workflow, knopf, stand) {
  if (!window.confirm("„" + workflow.titel + "“ auf main starten?")) return;
  await beschaeftigt(knopf, async () => {
    try {
      await github("workflowStarten", { datei: workflow.datei });
      statusZeigen("„" + workflow.titel + "“ gestartet. Der Stand aktualisiert sich gleich.");
      setTimeout(() => laufZeigen(workflow, stand), 8000);
    } catch (fehler) {
      statusZeigen(fehler.message, true);
    }
  });
}

// Pull Requests nach develop
async function prsLaden() {
  const liste = $("pr-liste");
  liste.replaceChildren(element("p", { klasse: "hinweis", text: "Lädt …" }));
  try {
    const offene = await github("offenePrs", { basis: "develop" });
    zaehlerSetzen("prs", offene.length);
    if (offene.length === 0) {
      liste.replaceChildren(element("p", { klasse: "hinweis", text: "Keine offenen Pull Requests nach develop." }));
      return;
    }
    // Erst die Einzelansicht sagt, ob GitHub mergen kann.
    const einzeln = await Promise.all(offene.map((pr) => github("pr", { nummer: pr.number })));
    liste.replaceChildren(...einzeln.map((pr) => prAnzeigen(pr, "develop", prsLaden)));
  } catch (fehler) {
    liste.replaceChildren(element("p", { klasse: "warnung", text: fehler.message }));
  }
}

function prAnzeigen(pr, basis, danach) {
  const zustand = prZustand(pr);
  return element("div", { klasse: "eintrag", "data-pr": String(pr.number) },
    element("h3", {}, element("a", { href: pr.html_url, target: "_blank", rel: "noopener", text: "#" + pr.number + " " + pr.title })),
    element("p", { klasse: "hinweis", text: "von " + pr.head.ref + " · " + zustand.text }),
    element("div", { klasse: "knoepfe" },
      element("button", { klasse: "knopf", type: "button", disabled: !zustand.mergebar, text: "Nach " + basis + " mergen",
        onclick: (e) => prMergen(pr, basis, e.currentTarget, danach) })));
}

async function prMergen(pr, basis, knopf, danach) {
  if (!window.confirm(mergeFrage(pr, basis))) return;
  await beschaeftigt(knopf, async () => {
    try {
      await github("prMergen", { nummer: pr.number, sha: pr.head.sha });
      statusZeigen("Pull Request #" + pr.number + " nach " + basis + " gemergt.");
      danach();
      // Nach einem Merge nach develop hat develop neue Commits für main.
      if (basis === "develop") mainBereichLaden();
    } catch (fehler) {
      statusZeigen(fehler.message, true);
    }
  });
}

$("prs-laden").addEventListener("click", prsLaden);

// develop → main: über einen Pull Request (so erkennt tag-nach-merge.yml den Merge).
async function mainBereichLaden() {
  const bereich = $("main-bereich");
  bereich.replaceChildren(element("p", { klasse: "hinweis", text: "Lädt …" }));
  try {
    const vergleich = await github("vergleich", { basis: "main", kopf: "develop" });
    zaehlerSetzen("main", vergleich.ahead_by);
    if (vergleich.ahead_by === 0) {
      bereich.replaceChildren(element("p", { klasse: "hinweis", text: "main ist auf dem Stand von develop. Nichts zu mergen." }));
      return;
    }
    const offen = (await github("offenePrs", { basis: "main" })).find((pr) => pr.head.ref === "develop");
    const hinweis = element("p", { klasse: "hinweis",
      text: "develop hat " + vergleich.ahead_by + " Commit(s), die noch nicht auf main sind." });
    if (!offen) {
      bereich.replaceChildren(hinweis, element("button", { klasse: "knopf", type: "button",
        text: "Pull Request develop → main anlegen", onclick: (e) => mainPrAnlegen(e.currentTarget) }));
      return;
    }
    bereich.replaceChildren(hinweis, prAnzeigen(await github("pr", { nummer: offen.number }), "main", mainBereichLaden));
  } catch (fehler) {
    bereich.replaceChildren(element("p", { klasse: "warnung", text: fehler.message }));
  }
}

async function mainPrAnlegen(knopf) {
  await beschaeftigt(knopf, async () => {
    try {
      await github("prAnlegen", { titel: "develop → main", kopf: "develop", basis: "main",
        text: "Angelegt über die Admin-Seite." });
      statusZeigen("Pull Request develop → main angelegt. GitHub prüft ihn kurz, dann lässt er sich mergen.");
      setTimeout(mainBereichLaden, 3000);
    } catch (fehler) {
      statusZeigen(fehler.message, true);
    }
  });
}
