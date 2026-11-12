// Admin-Seite (Ticket #43): Meldungen freigeben, Workflows starten, Pull Requests mergen.
// Menü nach Aufgaben (Ticket #111). Logik in admin-regeln.js, Anleitung in doku/ANLEITUNG-ADMIN.md.
//
// Schutz: Die Seite selbst ist öffentlich, ihr Code enthält keine Geheimnisse.
// - Meldungen lesen und freigeben erlaubt Supabase nur Konten aus der Tabelle „admins“
//   (Regeln in supabase/migrations/20261112170000_admins.sql).
// - Für GitHub braucht es ein Token, das die Admin selbst eingibt (nur im Browser-Tab).
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
let githubToken = "";
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
    $("github-hinweis").textContent = "Für „" + eintrag.titel + "“ brauchst du zuerst die GitHub-Verbindung.";
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

async function abmelden() {
  await client.auth.signOut();
  tokenVergessen();
  history.replaceState(null, "", location.pathname + location.search);
  statusZeigen("Abgemeldet.");
}
$("kein-admin-abmelden").addEventListener("click", abmelden);

async function anmeldungAnzeigen(sitzung) {
  const angemeldet = Boolean(sitzung);
  istAdminAngemeldet = false;
  $("anmeldung").hidden = angemeldet;
  $("kein-admin").hidden = true;
  $("verwaltung").hidden = true;
  if (!angemeldet) {
    $("email-formular").hidden = false;
    $("code-formular").hidden = true;
    return;
  }
  const { data: istAdmin, error } = await client.rpc("ist_admin");
  if (error || istAdmin !== true) {
    $("kein-admin").hidden = false;
    return;
  }
  istAdminAngemeldet = true;
  $("verwaltung").hidden = false;
  menueZeichnen();
  bereichZeigen();
  meldungenLaden();
  tokenAusSpeicher();
}

client.auth.onAuthStateChange(function (ereignis, sitzung) {
  // Nicht direkt im Rückruf auf Supabase warten (sonst kann die Bibliothek hängen bleiben).
  setTimeout(() => anmeldungAnzeigen(sitzung), 0);
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

// --- GitHub ------------------------------------------------------------------------------

async function github(art, werte) {
  const anfrage = githubAnfrage(art, werte);
  let antwort;
  try {
    antwort = await fetch(anfrage.adresse, {
      method: anfrage.methode,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + githubToken,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(anfrage.daten ? { "Content-Type": "application/json" } : {})
      },
      body: anfrage.daten ? JSON.stringify(anfrage.daten) : undefined
    });
  } catch (fehler) {
    throw new Error(githubFehlerText(0));
  }
  if (!antwort.ok) {
    let nachricht = "";
    try { nachricht = (await antwort.json()).message; } catch (fehler) { /* keine Details */ }
    throw new Error(githubFehlerText(antwort.status, nachricht));
  }
  return antwort.status === 204 ? null : antwort.json();
}

function tokenAusSpeicher() {
  try { githubToken = sessionStorage.getItem(TOKEN_SPEICHER) || ""; } catch (fehler) { githubToken = ""; }
  if (githubToken) githubVerbinden();
}

function tokenVergessen() {
  githubToken = "";
  githubVerbunden = false;
  try { sessionStorage.removeItem(TOKEN_SPEICHER); } catch (fehler) { /* egal */ }
  $("github-bereich").hidden = true;
  $("token-formular").hidden = false;
  for (const bereich of ["prs", "main"]) zaehlerSetzen(bereich, null);
}

$("token-formular").addEventListener("submit", async function (ereignis) {
  ereignis.preventDefault();
  const token = this.elements.token.value.trim();
  const fehler = tokenPruefen(token);
  if (fehler) return statusZeigen(fehler, true);
  githubToken = token;
  this.elements.token.value = "";
  await beschaeftigt(this.querySelector("button"), githubVerbinden);
});

$("token-vergessen").addEventListener("click", () => { tokenVergessen(); statusZeigen("Token vergessen."); });

async function githubVerbinden() {
  try {
    const [nutzer, repo] = await Promise.all([github("ich"), github("repo")]);
    if (!repo.permissions || !repo.permissions.push) {
      throw new Error("Das Konto " + nutzer.login + " darf in " + ADMIN_REPO + " nicht schreiben.");
    }
    try { sessionStorage.setItem(TOKEN_SPEICHER, githubToken); } catch (fehler) { /* dann nur bis zum Neuladen */ }
    githubVerbunden = true;
    $("github-nutzer").textContent = "Verbunden als " + nutzer.login + " mit " + ADMIN_REPO + ".";
    $("token-formular").hidden = true;
    $("github-bereich").hidden = false;
    $("github-hinweis").hidden = true;
    statusZeigen("");
    workflowsAnzeigen();
    prsLaden();
    mainBereichLaden();
    // Wollte die Admin eigentlich woanders hin, geht es jetzt dorthin.
    if (nachDemVerbinden) {
      const ziel = nachDemVerbinden;
      nachDemVerbinden = null;
      if (location.hash === "#" + ziel) bereichZeigen(); else location.hash = ziel;
    } else {
      bereichZeigen();
    }
  } catch (fehler) {
    tokenVergessen();
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
