import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { AUSGABE_KATEGORIEN } from '@/lib/ausgaben/text';
import { PRIVAT_AUSGABE_KATEGORIEN, PRIVAT_KATEGORIEN } from '@/lib/privat/text';
import type { KiModell } from '@/lib/ki/modelle';

/**
 * تنها راه رسیدن داده به AI (CLAUDE.md، قانون ۲؛ ESLint هر import دیگری از `@anthropic-ai/*` را رد می‌کند).
 * سه کار: خواندن رسید خرید (Ausgaben لابراتوار یا از ۲۵ اکتبر ۲۰۲۶ خرید شخصی «Privat»)، Kontoauszug بانک (Spec فاز ۵،
 * قدم ۴)، و «Frag deine Zahlen» (قدم ۶: فقط سؤال Inhaber و جواب پرسش‌های ثابت `lib/fragen/werkzeuge.ts`، بدون دادهٔ
 * بیمار). ورودی رسید و Kontoauszug فقط همان فایلی است که Inhaber بالا گذاشته؛ هیچ داده‌ای از سفارش‌ها، بیماران یا Ordinationها از این‌جا نمی‌گذرد. جواب با Structured Output
 * (zod) می‌آید و فقط پیشنهاد است: تا Inhaber «Übernehmen» نزند، چیزی در حساب نمی‌رود.
 */

export const BELEG_FELDER = ['lieferant', 'rechnungsnummer', 'rechnungsdatum', 'netto', 'mwst', 'brutto', 'mwstSatz', 'kategorie'] as const;

export const belegVorschlagSchema = z.object({
  istRechnung: z.boolean().describe('false, wenn das Bild keine Rechnung und kein Kassabon ist'),
  lieferant: z.string().nullable().describe('Firma, die die Rechnung ausgestellt hat (nicht das Labor)'),
  rechnungsnummer: z.string().nullable().describe('Rechnungs- oder Belegnummer genau wie gedruckt; null, wenn keine'),
  rechnungsdatum: z.string().nullable().describe('Rechnungsdatum als YYYY-MM-DD'),
  waehrung: z.string().describe('ISO-Code der Währung, meist EUR'),
  netto: z.number().nullable().describe('Summe ohne Umsatzsteuer'),
  mwst: z.number().nullable().describe('gesamte Umsatzsteuer'),
  brutto: z.number().nullable().describe('Gesamtbetrag inklusive Umsatzsteuer'),
  mwstSatz: z.enum(['20', '13', '10', '0', 'gemischt']).nullable().describe('»gemischt« bei mehreren Sätzen oder ausländischem Satz'),
  bereich: z.enum(['ddl', 'privat']).describe('ddl = Einkauf für das Labor, privat = privater Einkauf des Inhabers'),
  kategorie: z.enum(AUSGABE_KATEGORIEN).nullable().describe('nur bei bereich = ddl, sonst null'),
  privatKategorie: z.enum(PRIVAT_AUSGABE_KATEGORIEN).nullable().describe('nur bei bereich = privat, sonst null'),
  beschreibung: z.string().nullable().describe('kurz auf Deutsch, was gekauft wurde, höchstens 80 Zeichen'),
  unsicher: z.array(z.enum(BELEG_FELDER)).describe('Felder, die schlecht lesbar oder geschätzt sind'),
  hinweis: z.string().nullable().describe('kurzer Hinweis auf Deutsch, z. B. fremde Währung oder Gutschrift; sonst null'),
});
export type BelegVorschlag = z.infer<typeof belegVorschlagSchema>;

const SYSTEM = `Du liest Eingangsrechnungen und Kassabons für den Inhaber eines kleinen Dentallabors in Wien (Digital Dental Lab): für die Buchhaltung des Labors oder für seine privaten Ausgaben. Übertrage die Angaben genau so, wie sie auf dem Beleg stehen, und erfinde nichts: Was nicht lesbar ist, bleibt null und kommt in »unsicher«.

- Beträge als Zahl mit Punkt als Dezimaltrennzeichen, in der Währung des Belegs. Steht nur der Gesamtbetrag mit Steuersatz da, rechne Netto und Steuer daraus und markiere »netto« und »mwst« als unsicher.
- mwstSatz: 20, 13, 10 oder 0 Prozent (österreichische Sätze); bei mehreren Sätzen auf einem Beleg oder einem ausländischen Satz (z. B. 19 % aus Deutschland) »gemischt«.
- Kategorie: material = Resins, Kartuschen, Verbrauchsmaterial für Druck und Labor; geraete = Drucker, Scanner, Waschgeräte, Werkzeug, Computer; software = Lizenzen, Abos, Cloud-Dienste; versand = Post, Pakete, Kurier, Fahrten, Treibstoff, Parken; buero = Telefon, Internet, Büromaterial, Reinigung; sonstiges = alles andere.
- Lieferant ist der Aussteller, nie das Labor selbst als Empfänger.
- bereich: ddl für alles, was ein Dentallabor beruflich braucht (Dentalmaterial, Resins, Geräte, Software, Versand, Büro) oder wenn die Rechnung an das Labor bzw. »Digital Dental Lab« adressiert ist. privat für Alltagseinkäufe ohne Laborbezug: Supermarkt, Drogerie, Restaurant, Café, Kleidung, Freizeit, Apotheke, Tanken mit privatem Bezug. Im Zweifel ddl.
- Bei bereich = privat: kategorie = null und privatKategorie wählen (lebensmittel, restaurant, wohnen, haushalt (Möbel, Deko, Geräte und Dinge für die Wohnung, z. B. von IKEA oder Amazon), energie, oeffis, auto, gesundheit, kleidung, freizeit, abos, bildung, geschenke, versicherungen, kredit, sonstiges). Bei bereich = ddl: privatKategorie = null.`;

/** Bildformate, die Claude liest; HEIC nicht (iPhone-Fotos kommen im Browser meist schon als JPEG). */
const BILDTYPEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const BILD_MAX_BYTES = 5 * 1024 * 1024;

export type KiLesen =
  | { ok: true; vorschlag: BelegVorschlag; modell: string; eingabeTokens: number; ausgabeTokens: number }
  | { ok: false; fehler: string; modell: string; eingabeTokens: number; ausgabeTokens: number };

function client(schluessel: string) {
  // KI_API_URL nur für die Testumgebung (nachgebaute API in `scripts/qa-ausgaben.mjs`)
  return new Anthropic({ apiKey: schluessel, baseURL: process.env.KI_API_URL || undefined, maxRetries: 2, timeout: 120_000 });
}

function fehlerText(e: unknown): string | null {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'Der KI-Schlüssel wird von Anthropic nicht angenommen. Bitte unter Einstellungen → KI prüfen.';
  if (e instanceof Anthropic.NotFoundError) return 'Dieses Modell ist für den Schlüssel nicht verfügbar. Bitte unter Einstellungen → KI ein anderes wählen.';
  if (e instanceof Anthropic.RateLimitError) return 'Anthropic meldet zu viele Anfragen. Bitte in einer Minute erneut lesen lassen.';
  if (e instanceof Anthropic.BadRequestError) return `Anthropic lehnt die Anfrage ab: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Keine Verbindung zu Anthropic. Bitte später erneut lesen lassen.';
  if (e instanceof Anthropic.APIError) return `Anthropic antwortet mit einem Fehler (${e.status ?? '?'}). Bitte später erneut lesen lassen.`;
  return null;
}

export async function belegLesen(beleg: { inhalt: Buffer; typ: string }, ki: { schluessel: string; modell: KiModell }): Promise<KiLesen> {
  const leer = { modell: ki.modell, eingabeTokens: 0, ausgabeTokens: 0 };
  let datei: Anthropic.Beta.BetaContentBlockParam;
  if (beleg.typ === 'application/pdf') {
    datei = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: beleg.inhalt.toString('base64') } };
  } else if ((BILDTYPEN as readonly string[]).includes(beleg.typ)) {
    if (beleg.inhalt.length > BILD_MAX_BYTES) return { ok: false, fehler: 'Das Foto ist zum Lesen zu groß (über 5 MB). Bitte die Angaben von Hand eintragen.', ...leer };
    datei = { type: 'image', source: { type: 'base64', media_type: beleg.typ as (typeof BILDTYPEN)[number], data: beleg.inhalt.toString('base64') } };
  } else {
    return { ok: false, fehler: 'Dieses Format (z. B. HEIC) kann die KI nicht lesen. Bitte als JPG oder PDF hochladen oder von Hand eintragen.', ...leer };
  }

  try {
    const antwort = await client(ki.schluessel).beta.messages.parse({
      model: ki.modell,
      max_tokens: 16000,
      // Bei einer Ablehnung durch Sicherheitsfilter beantwortet ein anderes Modell dieselbe Anfrage (nicht bei Haiku)
      ...(ki.modell === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      output_config: { effort: 'medium', format: betaZodOutputFormat(belegVorschlagSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: [datei, { type: 'text', text: 'Lies diesen Beleg.' }] }],
    });
    const verbrauch = { modell: antwort.model, eingabeTokens: antwort.usage.input_tokens, ausgabeTokens: antwort.usage.output_tokens };
    if (antwort.stop_reason === 'refusal') return { ok: false, fehler: 'Die KI hat das Lesen abgelehnt. Bitte von Hand eintragen.', ...verbrauch };
    if (antwort.stop_reason === 'max_tokens' || !antwort.parsed_output) return { ok: false, fehler: 'Die KI hat keine vollständige Antwort geliefert. Bitte erneut lesen lassen.', ...verbrauch };
    return { ok: true, vorschlag: antwort.parsed_output, ...verbrauch };
  } catch (e) {
    const text = fehlerText(e);
    if (text) return { ok: false, fehler: text, ...leer };
    // Antwort passt nicht zum Schema (z. B. ältere Antwortform): Beleg bleibt zum Eintragen von Hand, kein Serverfehler
    if (e instanceof Error && /structured output/i.test(e.message)) return { ok: false, fehler: 'Die KI hat keine vollständige Antwort geliefert. Bitte erneut lesen lassen oder von Hand eintragen.', ...leer };
    throw e;
  }
}

// ════════════════ Kontoauszug (Spec فاز ۵، قدم ۴) ════════════════

const umsatzSchema = z.object({
  buchungstag: z.string().describe('Buchungstag als YYYY-MM-DD'),
  valuta: z.string().nullable().describe('Valuta/Wert als YYYY-MM-DD, falls gedruckt'),
  betrag: z.number().describe('Eingang positiv, Ausgang negativ, in Euro mit Punkt als Dezimaltrennzeichen'),
  gegenpartei: z.string().nullable().describe('kurzer Name des Gegenübers, z. B. »BILLA«, »Foodora«, »Amazon«, Name der Person oder Firma'),
  iban: z.string().nullable().describe('IBAN des Gegenübers, falls gedruckt'),
  text: z.string().describe('gesamter Buchungstext dieser Zeile, in einer Zeile, ohne Seitenköpfe'),
  referenz: z.string().nullable().describe('Referenz der Bank wie »MC/000001716« oder »OG/000001718«, genau wie gedruckt'),
  bereich: z.enum(['ddl', 'privat', 'ignorieren']),
  kategorie: z.enum(AUSGABE_KATEGORIEN).nullable().describe('nur bei bereich = ddl und Ausgang'),
  privatKategorie: z.enum(PRIVAT_KATEGORIEN).nullable().describe('nur bei bereich = privat'),
  rechnungsnummer: z.string().nullable().describe('Rechnungsnummer des Labors im Text, Form R-JJJJ-NNNN; sonst null'),
});

export const kontoauszugSchema = z.object({
  istKontoauszug: z.boolean(),
  iban: z.string().nullable().describe('IBAN des Kontos, dessen Auszug das ist'),
  auszugNummer: z.string().nullable(),
  auszugDatum: z.string().nullable().describe('Datum des Auszugs als YYYY-MM-DD'),
  alterKontostand: z.number().nullable().describe('alter Kontostand; im Minus negativ'),
  neuerKontostand: z.number().nullable().describe('neuer Kontostand; im Minus negativ'),
  summeEin: z.number().nullable(),
  summeAus: z.number().nullable().describe('als positive Zahl'),
  umsaetze: z.array(umsatzSchema).describe('alle Buchungszeilen in der gedruckten Reihenfolge, keine auslassen'),
});
export type KontoauszugGelesen = z.infer<typeof kontoauszugSchema>;

/** gemeinsam für PDF-Auszug und CSV-Umsatzliste */
const REGELN_BEREICH = `- bereich: ddl für Einnahmen von Zahnarztpraxen (Ordinationen) und für Ausgaben, die ein Dentallabor beruflich braucht (Dentalmaterial, Resins, Laborgeräte, Software und Cloud-Dienste für die Arbeit, Domain und Hosting, Versand). privat für Lebensmittel, Restaurants, Lieferdienste, Kleidung, Drogerie, Freizeit, Streaming, Gehalt (»Lohn«), Wohnung, private Fahrten. ignorieren für Überweisungen zwischen eigenen Konten oder Familienmitgliedern ohne erkennbaren Zweck, und für Zahlungen an die SVS (Sozialversicherung der Selbständigen) oder das Finanzamt (diese rechnet die Steuer-Vorschau getrennt ein). Im Zweifel privat.
- privatKategorie bei Eingängen: gehalt, entnahme, rueckzahlung (zurückgezahltes verliehenes Geld, z. B. »Rückzahlung«, »zurück«) oder sonstige_einnahme; bei Ausgängen: lebensmittel, restaurant (auch Lieferdienste), wohnen, haushalt (Möbel, Deko, Geräte für die Wohnung), energie, oeffis (auch Taxi/Bolt), auto, gesundheit, kleidung, freizeit, abos, bildung, geschenke, versicherungen, kredit, verliehen (Geld an jemanden verliehen, nur wenn der Text es sagt), sonstiges.`;

const SYSTEM_AUSZUG = `Du liest Kontoauszüge (PDF) einer österreichischen Bank für den Inhaber eines kleinen Dentallabors in Wien (Digital Dental Lab). Das Konto ist gemischt: privat und für das Labor. Übertrage jede Buchungszeile genau, erfinde nichts und lass keine aus; die Summe aller Beträge muss neuer minus alter Kontostand ergeben.

- Ein Auszug kann viele Blätter haben; Seitenköpfe (»KONTOAUSZUG … Blatt …«, Alter Kontostand) wiederholen sich und sind keine Buchungen. Die Zusammenfassung (Summe Ein, Summe Aus, Neuer Kontostand) steht oft auf dem letzten Blatt, manchmal am Anfang.
- Buchungstag: Auf dem Auszug steht meist nur Tag und Monat; das Jahr ergibt sich aus dem Datum des Auszugs (ein Jänner-Auszug kann Buchungen aus dem Dezember des Vorjahres enthalten).
- Betrag: Beträge mit »-« am Ende sind Ausgänge (negativ). Bei Kartenzahlungen in fremder Währung zählt der Euro-Betrag rechts, nicht der Betrag in Dollar.
- text: alle Zeilen der Buchung zusammen (Händler, Verwendungszweck, Kartenangaben), damit der Inhaber sie wiedererkennt.
${REGELN_BEREICH}`;

export type AuszugLesen =
  | { ok: true; auszug: KontoauszugGelesen; modell: string; eingabeTokens: number; ausgabeTokens: number }
  | { ok: false; fehler: string; modell: string; eingabeTokens: number; ausgabeTokens: number };

export async function kontoauszugLesen(pdf: Buffer, ki: { schluessel: string; modell: KiModell }): Promise<AuszugLesen> {
  const leer = { modell: ki.modell, eingabeTokens: 0, ausgabeTokens: 0 };
  try {
    const antwort = await client(ki.schluessel).beta.messages.parse({
      model: ki.modell,
      max_tokens: 32000,
      ...(ki.modell === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      output_config: { effort: 'medium', format: betaZodOutputFormat(kontoauszugSchema) },
      system: SYSTEM_AUSZUG,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
            { type: 'text', text: 'Lies diesen Kontoauszug vollständig.' },
          ],
        },
      ],
    });
    const verbrauch = { modell: antwort.model, eingabeTokens: antwort.usage.input_tokens, ausgabeTokens: antwort.usage.output_tokens };
    if (antwort.stop_reason === 'refusal') return { ok: false, fehler: 'Die KI hat das Lesen abgelehnt.', ...verbrauch };
    if (antwort.stop_reason === 'max_tokens' || !antwort.parsed_output)
      return { ok: false, fehler: 'Der Kontoauszug ist zu lang für einmal Lesen. Bitte einen kürzeren Zeitraum hochladen.', ...verbrauch };
    return { ok: true, auszug: antwort.parsed_output, ...verbrauch };
  } catch (e) {
    const text = fehlerText(e);
    if (text) return { ok: false, fehler: text, ...leer };
    if (e instanceof Error && /structured output/i.test(e.message)) return { ok: false, fehler: 'Die KI hat keine vollständige Antwort geliefert. Bitte erneut lesen lassen.', ...leer };
    throw e;
  }
}

// ════════════════ Umsatzliste (CSV) einordnen ════════════════

const einordnungSchema = z.object({
  zeilen: z.array(
    umsatzSchema.pick({ gegenpartei: true, bereich: true, kategorie: true, privatKategorie: true, rechnungsnummer: true }).extend({
      nr: z.number().int().describe('Nummer der Zeile wie in der Liste'),
    }),
  ),
});
export type Einordnung = z.infer<typeof einordnungSchema>['zeilen'][number];

const SYSTEM_EINORDNEN = `Du ordnest Buchungszeilen aus der Umsatzliste (CSV) einer österreichischen Bank ein, für den Inhaber eines kleinen Dentallabors in Wien (Digital Dental Lab). Das Konto ist gemischt: privat und für das Labor. Jede Zeile hat Nummer, Buchungstag, Betrag (Eingang positiv, Ausgang negativ) und Buchungstext. Die Beträge stimmen schon; gib für jede Nummer genau eine Antwort.

- gegenpartei: kurzer Name des Gegenübers aus dem Text (z. B. »BILLA«, »Bolt«, »Amazon«, Name der Person oder Firma); null, wenn keiner erkennbar ist (z. B. Kontoführung).
- kategorie (nur bei bereich = ddl und Ausgang): material, geraete, software, versand, buero, sonstiges.
- rechnungsnummer: Rechnungsnummer des Labors im Text, Form R-JJJJ-NNNN; sonst null.
${REGELN_BEREICH}`;

/** höchstens so viele Zeilen pro Anfrage, damit die Antwort sicher in `max_tokens` passt */
const EINORDNEN_PRO_ANFRAGE = 120;

export type EinordnenErgebnis =
  | { ok: true; zeilen: Map<number, Einordnung>; modell: string; eingabeTokens: number; ausgabeTokens: number }
  | { ok: false; fehler: string; modell: string; eingabeTokens: number; ausgabeTokens: number };

/** Nur Buchungstag, Betrag und Buchungstext gehen an Anthropic (dieselben Angaben wie auf dem PDF-Auszug). */
export async function umsaetzeEinordnen(
  zeilen: { buchungstag: string; betragCent: number; text: string }[],
  ki: { schluessel: string; modell: KiModell },
): Promise<EinordnenErgebnis> {
  const ergebnis = new Map<number, Einordnung>();
  let modell: string = ki.modell;
  let eingabeTokens = 0;
  let ausgabeTokens = 0;
  const stuecke: number[] = [];
  for (let i = 0; i < zeilen.length; i += EINORDNEN_PRO_ANFRAGE) stuecke.push(i);
  try {
    // drei Anfragen gleichzeitig: eine lange Umsatzliste (ein Jahr) dauert so etwa eine Minute
    for (let s = 0; s < stuecke.length; s += 3) {
      const antworten = await Promise.all(
        stuecke.slice(s, s + 3).map((von) => {
          const liste = zeilen
            .slice(von, von + EINORDNEN_PRO_ANFRAGE)
            .map((z, j) => `${von + j + 1} | ${z.buchungstag} | ${(z.betragCent / 100).toFixed(2)} | ${z.text}`)
            .join('\n');
          return client(ki.schluessel).beta.messages.parse({
            model: ki.modell,
            max_tokens: 32000,
            ...(ki.modell === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
            output_config: { effort: 'low', format: betaZodOutputFormat(einordnungSchema) },
            system: SYSTEM_EINORDNEN,
            messages: [{ role: 'user', content: `Ordne diese Buchungszeilen ein (Nr | Buchungstag | Betrag | Text):\n\n${liste}` }],
          });
        }),
      );
      for (const a of antworten) {
        modell = a.model;
        eingabeTokens += a.usage.input_tokens;
        ausgabeTokens += a.usage.output_tokens;
        if (a.stop_reason === 'refusal') return { ok: false, fehler: 'Die KI hat das Einordnen abgelehnt.', modell, eingabeTokens, ausgabeTokens };
        for (const z of a.parsed_output?.zeilen ?? []) ergebnis.set(z.nr - 1, z);
      }
    }
    return { ok: true, zeilen: ergebnis, modell, eingabeTokens, ausgabeTokens };
  } catch (e) {
    const text = fehlerText(e);
    if (text) return { ok: false, fehler: text, modell, eingabeTokens, ausgabeTokens };
    if (e instanceof Error && /structured output/i.test(e.message)) return { ok: false, fehler: 'Die KI hat keine vollständige Antwort geliefert. Bitte erneut lesen lassen.', modell, eingabeTokens, ausgabeTokens };
    throw e;
  }
}

// ════════════════ «Frag deine Zahlen» (Spec فاز ۵، قدم ۶) ════════════════

export type FrageWerkzeug = { name: string; description: string; schema: z.ZodType };
export type FragenAntwort =
  | { ok: true; antwort: string; aufrufe: { name: string; eingabe: unknown }[]; modell: string; eingabeTokens: number; ausgabeTokens: number }
  | { ok: false; fehler: string; modell: string; eingabeTokens: number; ausgabeTokens: number };

const systemFragen = (heute: string) => `Du beantwortest Fragen des Inhabers eines kleinen Dentallabors in Wien (Digital Dental Lab) zu seinen eigenen Zahlen: dem Labor (bereich ddl) und seinem privaten Geld (bereich privat). Heute ist ${heute}.

- Nutze nur die Werkzeuge; erfinde keine Zahlen. Wenn die Werkzeuge etwas nicht hergeben, sag das ehrlich.
- Antworte in der Sprache der Frage (Deutsch oder Persisch), kurz und klar, in wenigen Sätzen oder einer kurzen Liste. Kein Markdown außer einfachen Listen mit »-«.
- Nenne immer den Zeitraum, auf den sich die Zahl bezieht. Beträge im österreichischen Format (z. B. € 1.234,50), auch in einer persischen Antwort.
- Zeiträume: »dieses Jahr« = 1. Jänner bis heute; »letztes Quartal« = das letzte abgeschlossene Kalenderquartal; »letzter Monat« = der vorige Kalendermonat.
- Umsatz einer Ordination = fakturiert; eingegangenes Geld = einnahmen. Zahlen zur Steuer sind eine Schätzung, keine Steuerberatung.`;

/**
 * Frage mit Werkzeugen beantworten: höchstens sechs Runden Werkzeug-Aufrufe. `ausfuehren` läuft im CRM (nur die
 * festen Abfragen); an Anthropic gehen nur die Frage, frühere Fragen und Antworten dieser Sitzung und die Ergebnisse.
 */
export async function zahlenFragen(
  frage: string,
  verlauf: { frage: string; antwort: string }[],
  werkzeuge: readonly FrageWerkzeug[],
  ausfuehren: (name: string, eingabe: unknown) => Promise<unknown>,
  ki: { schluessel: string; modell: KiModell },
  heute: string,
): Promise<FragenAntwort> {
  const verbrauch: { modell: string; eingabeTokens: number; ausgabeTokens: number } = { modell: ki.modell, eingabeTokens: 0, ausgabeTokens: 0 };
  const tools = werkzeuge.map((w) => ({ name: w.name, description: w.description, input_schema: z.toJSONSchema(w.schema, { io: 'input' }) as Anthropic.Tool.InputSchema }));
  const messages: Anthropic.MessageParam[] = [
    ...verlauf.slice(-3).flatMap((v) => [
      { role: 'user' as const, content: v.frage },
      { role: 'assistant' as const, content: v.antwort },
    ]),
    { role: 'user', content: frage },
  ];
  const aufrufe: { name: string; eingabe: unknown }[] = [];
  try {
    for (let runde = 0; runde < 7; runde++) {
      const antwort = await client(ki.schluessel).messages.create({ model: ki.modell, max_tokens: 4000, system: systemFragen(heute), tools, messages });
      verbrauch.modell = antwort.model;
      verbrauch.eingabeTokens += antwort.usage.input_tokens;
      verbrauch.ausgabeTokens += antwort.usage.output_tokens;
      if (antwort.stop_reason === 'refusal') return { ok: false, fehler: 'Die KI hat die Antwort abgelehnt.', ...verbrauch };
      const werkzeugBloecke = antwort.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (antwort.stop_reason !== 'tool_use' || !werkzeugBloecke.length) {
        const text = antwort.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return text ? { ok: true, antwort: text, aufrufe, ...verbrauch } : { ok: false, fehler: 'Die KI hat keine Antwort geliefert. Bitte anders fragen.', ...verbrauch };
      }
      if (runde === 6) break;
      messages.push({ role: 'assistant', content: antwort.content });
      const ergebnisse: Anthropic.ToolResultBlockParam[] = [];
      for (const b of werkzeugBloecke) {
        aufrufe.push({ name: b.name, eingabe: b.input });
        ergebnisse.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(await ausfuehren(b.name, b.input)) });
      }
      messages.push({ role: 'user', content: ergebnisse });
    }
    return { ok: false, fehler: 'Die Frage war zu umfangreich. Bitte enger fragen (z. B. einen Zeitraum nennen).', ...verbrauch };
  } catch (e) {
    const text = fehlerText(e);
    if (text) return { ok: false, fehler: text, ...verbrauch };
    throw e;
  }
}

/** «Verbindung testen»: fragt nur die Modellangaben ab, kostet nichts. */
export async function kiVerbindungTesten(ki: { schluessel: string; modell: KiModell }): Promise<string | null> {
  try {
    await client(ki.schluessel).models.retrieve(ki.modell);
    return null;
  } catch (e) {
    return fehlerText(e) ?? 'Unbekannter Fehler bei der Verbindung zu Anthropic.';
  }
}
