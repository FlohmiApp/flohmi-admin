// Zugang zur Datenbank für „Markt melden“. Beide Werte stehen in Supabase unter
// Settings → API Keys. Der öffentliche Schlüssel (Publishable key) darf hier stehen.
// Der geheime Schlüssel darf NIEMALS in den Ordner www, er gehört nur in geheim.json.

const SUPABASE_URL = "https://jqmwfwoztvwgohrhdhet.supabase.co";
const SUPABASE_SCHLUESSEL = "sb_publishable_8oubcByECwtHvvGTXARk7w_rRjDznfB";

// Kontaktadresse für die Ortssuche bei Nominatim (OpenStreetMap). Die Android-App
// ist für Nominatim sonst nicht erkennbar. Die Adresse geht mit jeder Suche an
// Nominatim und steht öffentlich im Code, also am besten eine eigene Projekt-Adresse.
const NOMINATIM_EMAIL = "";

// Feste Ortsliste (Landau, Neustadt, Speyer, …) als Schnellauswahl unter der Suche.
// true = anzeigen, false = ausblenden. Die Orte stehen in app.js unter ORTE.
const ORTS_SCHNELLAUSWAHL = false;
