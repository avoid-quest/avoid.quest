#!/usr/bin/env bun

/**
 * Test script for improving metadata extraction
 *
 * Usage:
 *   bun test-metadata-extraction.ts --post-id <id>
 *   bun test-metadata-extraction.ts --post-id <id> --prompt <prompt-name>
 *   bun test-metadata-extraction.ts --fetch-recent <limit>
 *   bun test-metadata-extraction.ts --compare <p1,p2,...> --post-id <id>
 *
 * Environment:
 *   GOOGLE_GENERATIVE_AI_API_KEY - Required
 *   CONVEX_URL - Required for fetching posts from Convex
 */

import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";
import { api } from "./convex/_generated/api";
import type { Doc, Id } from "./convex/_generated/dataModel";

// Constants
const MAX_EVENT_SCORE = 100;
const MIN_EVENT_SCORE = 0;
const OUTPUT_WIDTH = 80;
const CAPTION_PREVIEW_LENGTH = 100;
const DEFAULT_PROMPT_NAME = "default";
const PRODUCTION_PROMPT_LABEL = " (current production prompt)";
const DEFAULT_FETCH_LIMIT = 5;
const PROMPT_NAME_PADDING = 20;

// Zod schema matching the production schema
const postMetadataZodSchema = z.object({
  event_score: z.number().min(MIN_EVENT_SCORE).max(MAX_EVENT_SCORE),
  event_date_start: z.number().optional(),
  event_date_end: z.number().optional(),
  event_time_start: z.string().optional(),
  event_time_end: z.string().optional(),
  location: z.string().optional(),
  location_address: z.string().optional(),
  location_coordinates: z
    .object({
      lat: z.number(),
      lng: z.number(),
    })
    .optional(),
  event_type: z
    .enum([
      "concert",
      "workshop",
      "conference",
      "festival",
      "exhibition",
      "meetup",
      "other",
    ])
    .optional(),
  event_title: z.string().optional(),
  organizer_name: z.string().optional(),
  organizer_contact: z.string().optional(),
  target_audience: z.array(z.string()).optional(),
  registration_required: z.boolean().optional(),
  registration_url: z.string().url().optional(),
  ticket_price: z.string().optional(),
  event_description: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
  language: z.string().optional(),
  content_type: z
    .enum(["event_announcement", "event_reminder", "event_recap", "other"])
    .optional(),
});

type PostMetadataExtraction = z.infer<typeof postMetadataZodSchema>;

// Default system prompt (from production)
const DEFAULT_SYSTEM_PROMPT = `Sei un esperto nell'estrazione di informazioni relative ad eventi da didascalie di post Instagram.

Il tuo compito è analizzare la didascalia del post e il timestamp di pubblicazione per estrarre metadati strutturati sugli eventi. Un "evento" è definito come qualsiasi raduno, performance, workshop, incontro, concerto, conferenza, festival, mostra, esposizione o attività simile che si svolge in un momento e/o luogo specifico.

## CAMPI DA COMPILARE

Devi estrarre e compilare i seguenti campi nel formato JSON strutturato:

**Campi OBBLIGATORI:**
- \`event_score\` (number, 0-100): Punteggio di confidenza che il post descriva un evento

**Campi OPZIONALI (compila solo se presenti nella didascalia):**
- \`event_date_start\` (number): Timestamp Unix in millisecondi della data di inizio evento
- \`event_date_end\` (number): Timestamp Unix in millisecondi della data di fine evento (per eventi con durata)
- \`event_time_start\` (string): Orario di inizio in formato stringa (es: "17:00", "19:30")
- \`event_time_end\` (string): Orario di fine in formato stringa (es: "20:00", "23:00")
- \`location\` (string): Nome del luogo/venue (es: "Chiesa di S. Michele")
- \`location_address\` (string): Indirizzo completo (es: "Piazza Cavour, Torino")
- \`location_coordinates\` (object): Coordinate geografiche {lat: number, lng: number} se note
- \`event_type\` (enum): "concert" | "workshop" | "conference" | "festival" | "exhibition" | "meetup" | "other"
- \`event_title\` (string): Titolo dell'evento
- \`event_description\` (string): Descrizione sintetica dell'evento
- \`organizer_name\` (string): Nome dell'organizzatore
- \`organizer_contact\` (string): Contatto organizzatore (email, telefono, social)
- \`target_audience\` (array of strings): Pubblico target (es: ["giovani artisti", "studenti"])
- \`registration_required\` (boolean): Se è richiesta registrazione
- \`registration_url\` (string): URL per registrazione/prenotazione
- \`ticket_price\` (string): Prezzo biglietto (es: "€10", "gratis", "€5-15")
- \`hashtags\` (array of strings): Tutti gli hashtag presenti (senza #)
- \`keywords\` (array of strings): Parole chiave rilevanti estratte dal testo
- \`language\` (string): Lingua principale della didascalia (es: "italiano", "inglese")
- \`content_type\` (enum): "event_announcement" | "event_reminder" | "event_recap" | "other"

## LINEE GUIDA DETTAGLIATE

### 1. Event Score (0-100) - OBBLIGATORIO
Determina quanto sei sicuro che questo post descriva un evento:
- **0-30**: Contenuti NON eventi (foto personali, paesaggi, arte senza contesto eventuale, post promozionali generici)
- **31-60**: Contenuti possibilmente correlati (menzioni generiche di eventi, contenuti culturali senza date/luoghi specifici)
- **61-80**: Eventi probabili (annunci con date o luoghi parziali, menzioni di attività future)
- **81-100**: Annunci di eventi CHIARI (con date, orari e luoghi specifici ben definiti)

### 2. Estrazione Date e Orari (CRITICO)
**REGOLA FONDAMENTALE**: Usa SEMPRE il timestamp di pubblicazione del post come riferimento temporale.

- **Date relative**: Se la didascalia menziona "oggi", "domani", "venerdì prossimo", "questo weekend", calcola la data assoluta usando il timestamp come punto di partenza
- **Date assolute**: Se la didascalia menziona "1 novembre 2025", "15 marzo 2024", usa quelle date esatte
- **Eventi con durata**: Per "dal 10 al 12 giugno" o "fino al 1 novembre", estrai sia \`event_date_start\` che \`event_date_end\`
- **Se solo data fine**: Se la didascalia dice "fino al 1 novembre 2025" e il timestamp è del 15 ottobre 2024, l'evento inizia approssimativamente alla data di pubblicazione (usa il timestamp del post come \`event_date_start\`)
- **Formati orari italiani**: Riconosci "h 17-20", "dalle 19 alle 23", "alle 20:00", "ore 18:30", "17:00-20:00"
- **Conversione**: Converti TUTTE le date in timestamp Unix in millisecondi (es: 1727740800000 per 1 ottobre 2024)
- **Fuso orario**: Assume sempre fuso orario Roma/Italia (UTC+1/UTC+2) a meno che non sia esplicitamente indicato

### 3. Estrazione Luogo
- **location**: Nome del venue/luogo (es: "Chiesa di S. Michele", "Teatro dell'Opera")
- **location_address**: Indirizzo completo quando disponibile (es: "Piazza Cavour, Torino", "Via Roma 10, Milano")
- **location_coordinates**: Coordinate geografiche solo per luoghi noti e facilmente identificabili
- **Riconosci formati**: "📍", "presso", "a", "in", "via", "piazza", "/" come separatore città

### 4. Tipo di Evento
Classifica usando questi valori esatti:
- **"exhibition"**: per mostre, esposizioni, vernissage
- **"concert"**: per concerti, performance musicali, dj set
- **"workshop"**: per workshop, laboratori, corsi
- **"conference"**: per conferenze, seminari, talk
- **"festival"**: per festival, rassegne
- **"meetup"**: per incontri, networking, aperitivi culturali
- **"other"**: per altri tipi di eventi

Riconosci termini italiani: concerto, workshop, conferenza, festival, mostra, esposizione, incontro, seminario, talk, dj set, party, vernissage, opening, rassegna

### 5. Tipo di Contenuto
- **"event_announcement"**: annuncio di evento futuro (promozione, save the date)
- **"event_reminder"**: promemoria per evento imminente (ricorda che..., ultimi giorni)
- **"event_recap"**: resoconto di evento passato (come è andato, foto dell'evento)
- **"other"**: altro tipo di contenuto

### 6. Organizzatore
- **organizer_name**: Nome dell'organizzatore/ente (spesso nei tag @username o nel testo iniziale)
- **organizer_contact**: Contatti se presenti (email, telefono, link social)
- **target_audience**: Pubblico target se menzionato (es: ["giovani artisti", "studenti universitari"])

### 7. Prezzi e Registrazione
- **ticket_price**: Estrai informazioni su prezzi ("€10", "gratis", "ingresso libero", "€5-15", "donazione libera")
- **registration_required**: true se menziona "registrazione obbligatoria", "prenotazione", "iscrizione", false altrimenti
- **registration_url**: URL completo per registrazione/prenotazione se presente

### 8. Hashtag e Keywords
- **hashtags**: Estrai TUTTI gli hashtag presenti nella didascalia (senza il simbolo #)
- **keywords**: Estrai parole chiave rilevanti dal testo (es: ["mostra collettiva", "giovani artisti", "arte contemporanea"])
- **language**: Identifica la lingua principale ("italiano", "inglese", "spagnolo", etc.)

### 9. Titolo e Descrizione
- **event_title**: Titolo dell'evento (spesso all'inizio della didascalia, prima della descrizione)
- **event_description**: Descrizione sintetica dell'evento (1-2 frasi che riassumono l'evento)

## ESEMPIO DI COMPILAZIONE

**Didascalia di esempio:**
\`\`\`
𝙄𝙉𝙏𝙍𝘼𝘾𝙊𝙍𝙀 x TOBE IV 2025/2026

La mostra collettiva inaugurale del progetto TOBE dedicato a giovani artistə presenta le opere di: 

Anouk Chambaz, Francesco Bendini, Benedetta Ferrari, Giulia Gaffo, Alessandra La Marca, Luce Lee, Sara Lepore, Giacomo Mallardo, Ginevra Mazzoni, Matteo Melotto, Filippo Minoglio, Eleonora Maria Navone, Giulia Querin, Nicole Ranzato, Snem Snem, Miho Tanaka, Pietro Vedovato e Federico Zeltman

Fino al 1 novembre 2025

📍Chiesa di S. Michele, Piazza Cavour / Torino

h 17 - 20
\`\`\`

**Timestamp di pubblicazione:** 15 ottobre 2024, 14:30

**Output JSON corretto:**
\`\`\`json
{
  "event_score": 90,
  "event_date_start": 1729008000000,
  "event_date_end": 1730419200000,
  "event_time_start": "17:00",
  "event_time_end": "20:00",
  "location": "Chiesa di S. Michele",
  "location_address": "Piazza Cavour, Torino",
  "event_type": "exhibition",
  "event_title": "INTRACORE x TOBE IV 2025/2026",
  "event_description": "Mostra collettiva inaugurale del progetto TOBE dedicato a giovani artistə",
  "organizer_name": "TOBE",
  "target_audience": ["giovani artisti"],
  "registration_required": false,
  "hashtags": [],
  "keywords": ["mostra collettiva", "giovani artisti", "arte contemporanea", "progetto TOBE"],
  "language": "italiano",
  "content_type": "event_announcement"
}
\`\`\`

**Spiegazione:**
- \`event_score: 90\` - Evento chiaro con date, orari e luogo specifici
- \`event_date_start\` - Timestamp del 15 ottobre 2024 (data di pubblicazione, inizio approssimativo)
- \`event_date_end\` - Timestamp del 1 novembre 2025 (data esplicita "fino al")
- \`event_time_start/end\` - Orari "h 17 - 20" convertiti in formato 24h
- \`location\` - Nome venue estratto
- \`location_address\` - Indirizzo completo con città
- \`event_type: "exhibition"\` - Mostra collettiva
- \`event_title\` - Titolo all'inizio della didascalia
- \`event_description\` - Sintesi del contenuto
- \`organizer_name\` - Progetto TOBE menzionato
- \`target_audience\` - "giovani artistə" menzionato
- \`language: "italiano"\` - Didascalia in italiano

## REGOLE FINALI

1. **Precisione**: Estrai SOLO informazioni chiaramente indicate o fortemente implicite nella didascalia
2. **Nessuna supposizione**: NON inventare informazioni non presenti
3. **Timestamp come riferimento**: Usa sempre il timestamp per contestualizzare date relative
4. **Campi opzionali**: Se un campo non è presente o non è deducibile, lascialo undefined/null (non includerlo nell'output)
5. **Formato date**: Converti SEMPRE le date in timestamp Unix in millisecondi
6. **Lingua**: Rispetta la lingua della didascalia, ma estrai sempre i dati nel formato richiesto

Output i metadati estratti nel formato JSON strutturato fornito.`;

// Alternative system prompts for testing
const SYSTEM_PROMPTS: Record<string, string> = {
  default: DEFAULT_SYSTEM_PROMPT,

  strict: `You are a strict event metadata extractor. Only extract information that is explicitly stated in the Instagram post caption.

Guidelines:
- Event Score: Be conservative. Only use 80-100 for clear, unambiguous event announcements with dates and locations.
- Dates: Only extract if explicitly stated. Do not infer from context.
- Location: Only extract if explicitly mentioned.
- Be very conservative with all fields. When in doubt, leave it optional.`,

  aggressive: `You are an aggressive event metadata extractor. Extract all possible information, even if it requires some inference.

Guidelines:
- Event Score: Use higher scores (60+) for any post that mentions events, gatherings, or activities.
- Dates: Infer dates from context clues (e.g., "this weekend", "next month").
- Location: Extract any location mentions, even if partial.
- Extract organizer info from hashtags or mentions if possible.
- Be thorough and extract as much as possible.`,

  italian_focused: `You are an expert at extracting event information from Italian Instagram posts.

Guidelines:
- Assume all events are in Italy unless stated otherwise.
- Recognize Italian date formats (e.g., "15 marzo", "venerdì 15").
- Understand Italian time expressions (e.g., "alle 20:00", "dalle 19 alle 23").
- Extract location names in Italian cities (Roma, Milano, Firenze, etc.).
- Recognize Italian event types (concerto, workshop, conferenza, festival, mostra, incontro).
- Extract hashtags and keywords in Italian context.`,

  date_focused: `You are an expert at extracting dates and times from Instagram post captions.

Guidelines:
- Prioritize accurate date/time extraction above all else.
- Convert all relative dates to absolute timestamps (Unix epoch milliseconds).
- Extract both start and end times for events with duration.
- Handle timezone conversions carefully (default to Rome/Italy timezone).
- Parse various date formats: "March 15", "15/03", "next Friday", "this weekend".
- Extract time in 24-hour format when possible.`,
};

/**
 * Get Convex HTTP client
 */
function getConvexClient(): ConvexHttpClient {
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    throw new Error("CONVEX_URL environment variable is required");
  }
  return new ConvexHttpClient(convexUrl);
}

/**
 * Fetch post by ID from Convex
 */
async function fetchPostById(
  client: ConvexHttpClient,
  postId: string
): Promise<Doc<"posts"> | null> {
  return await client.query(api.posts.getPostById, {
    id: postId as Id<"posts">,
  });
}

/**
 * Fetch recent posts from Convex
 */
async function fetchRecentPosts(
  client: ConvexHttpClient,
  limit: number
): Promise<Doc<"posts">[]> {
  return await client.query(api.posts.getPosts, { limit });
}

/**
 * Fetch unsent posts from Convex
 */
async function fetchUnsentPosts(
  client: ConvexHttpClient,
  limit: number
): Promise<Doc<"posts">[]> {
  return await client.query(api.posts.getUnsent, { limit });
}

/**
 * Format timestamp to readable date
 */
function formatTimestamp(ts?: number): string {
  if (!ts) {
    return "N/A";
  }
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "Europe/Rome",
    dateStyle: "full",
    timeStyle: "short",
  });
}

/**
 * Print section header
 */
function printSectionHeader(title: string): void {
  console.log(`\n${title}:`);
  console.log("-".repeat(OUTPUT_WIDTH));
}

/**
 * Print separator line
 */
function printSeparator(): void {
  console.log("=".repeat(OUTPUT_WIDTH));
}

/**
 * Print post information
 */
function printPostInfo(post: Doc<"posts">): void {
  printSectionHeader("📄 POST INFORMATION");
  console.log(`ID: ${post._id}`);
  console.log(`Shortcode: ${post.shortcode}`);
  console.log(`URL: ${post.url}`);
  console.log(`Media Type: ${post.media_type}`);
  console.log(`Timestamp: ${formatTimestamp(post.timestamp)}`);
  if (post.event_date) {
    console.log(`Event Date: ${formatTimestamp(post.event_date)}`);
  }
  console.log(`Sent: ${post.sent ? "Yes" : "No"}`);
  if (post.metadata_id) {
    console.log(`Has Metadata: Yes (${post.metadata_id})`);
  } else {
    console.log("Has Metadata: No");
  }
}

/**
 * Print metadata header section
 */
function printMetadataHeader(caption: string): void {
  console.log("\n");
  printSeparator();
  console.log("EXTRACTION RESULTS");
  printSeparator();

  printSectionHeader("📝 CAPTION");
  console.log(caption);
}

/**
 * Print basic metadata section
 */
function printBasicMetadata(metadata: PostMetadataExtraction): void {
  printSectionHeader("📊 METADATA");
  console.log(`Event Score: ${metadata.event_score}/${MAX_EVENT_SCORE}`);
  console.log(`Event Type: ${metadata.event_type || "N/A"}`);
  console.log(`Content Type: ${metadata.content_type || "N/A"}`);
}

/**
 * Print dates and times section
 */
function printDatesAndTimes(metadata: PostMetadataExtraction): void {
  printSectionHeader("📅 DATES & TIMES");
  console.log(`Start Date: ${formatTimestamp(metadata.event_date_start)}`);
  console.log(`End Date: ${formatTimestamp(metadata.event_date_end)}`);
  console.log(`Start Time: ${metadata.event_time_start || "N/A"}`);
  console.log(`End Time: ${metadata.event_time_end || "N/A"}`);
}

/**
 * Print location section
 */
function printLocation(metadata: PostMetadataExtraction): void {
  printSectionHeader("📍 LOCATION");
  console.log(`Location: ${metadata.location || "N/A"}`);
  console.log(`Address: ${metadata.location_address || "N/A"}`);
  if (metadata.location_coordinates) {
    const { lat, lng } = metadata.location_coordinates;
    console.log(`Coordinates: ${lat}, ${lng}`);
  }
}

/**
 * Print event details section
 */
function printEventDetails(metadata: PostMetadataExtraction): void {
  printSectionHeader("🎫 EVENT DETAILS");
  console.log(`Title: ${metadata.event_title || "N/A"}`);
  console.log(`Description: ${metadata.event_description || "N/A"}`);
  console.log(`Ticket Price: ${metadata.ticket_price || "N/A"}`);
  console.log(
    `Registration Required: ${metadata.registration_required ?? "N/A"}`
  );
  console.log(`Registration URL: ${metadata.registration_url || "N/A"}`);
}

/**
 * Print organizer section
 */
function printOrganizer(metadata: PostMetadataExtraction): void {
  printSectionHeader("👤 ORGANIZER");
  console.log(`Name: ${metadata.organizer_name || "N/A"}`);
  console.log(`Contact: ${metadata.organizer_contact || "N/A"}`);
  const audience = metadata.target_audience?.join(", ") || "N/A";
  console.log(`Target Audience: ${audience}`);
}

/**
 * Print tags and keywords section
 */
function printTagsAndKeywords(metadata: PostMetadataExtraction): void {
  printSectionHeader("🏷️  TAGS & KEYWORDS");
  const hashtags = metadata.hashtags?.join(", ") || "N/A";
  console.log(`Hashtags: ${hashtags}`);
  const keywords = metadata.keywords?.join(", ") || "N/A";
  console.log(`Keywords: ${keywords}`);
  console.log(`Language: ${metadata.language || "N/A"}`);
}

/**
 * Pretty print extracted metadata
 */
function printMetadata(
  metadata: PostMetadataExtraction,
  caption: string
): void {
  printMetadataHeader(caption);
  printBasicMetadata(metadata);
  printDatesAndTimes(metadata);
  printLocation(metadata);
  printEventDetails(metadata);
  printOrganizer(metadata);
  printTagsAndKeywords(metadata);

  console.log("\n");
  printSeparator();
  console.log("\n");
}

/**
 * Format timestamp for AI context (detailed Italian format)
 */
function formatTimestampForAI(timestamp: number): string {
  const date = new Date(timestamp);
  const options: Intl.DateTimeFormatOptions = {
    timeZone: "Europe/Rome",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  return date.toLocaleString("it-IT", options);
}

/**
 * Extract metadata using the AI model
 */
async function extractMetadata(
  post: Doc<"posts">,
  systemPrompt: string
): Promise<PostMetadataExtraction> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error(
      "GOOGLE_GENERATIVE_AI_API_KEY environment variable is required"
    );
  }

  const model = google("gemini-2.0-flash-exp");

  const timestampFormatted = formatTimestampForAI(post.timestamp);
  const userPrompt = `Analizza questa didascalia di post Instagram e il timestamp di pubblicazione per estrarre metadati relativi all'evento:

DIDASCALIA:
${post.caption}

INFORMAZIONI POST:
- URL: ${post.url}
- Shortcode: ${post.shortcode}
- Timestamp di pubblicazione: ${timestampFormatted}
- Timestamp Unix (ms): ${post.timestamp}

IMPORTANTE: Usa il timestamp di pubblicazione come riferimento temporale per interpretare le date menzionate nella didascalia. Se la didascalia menziona date relative ("oggi", "domani", "venerdì prossimo"), calcola la data assoluta usando il timestamp come punto di partenza.

Estrai tutte le informazioni rilevanti sull'evento inclusi:
- Date e orari (converti in timestamp Unix in millisecondi)
- Luogo (nome venue, indirizzo, città)
- Tipo di evento
- Dettagli organizzatore
- Prezzi e registrazione
- Hashtag e keywords
- Lingua della didascalia
- Titolo e descrizione evento
- Qualsiasi altro metadato rilevante`;

  const startTime = Date.now();
  const result = await generateObject({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    schema: postMetadataZodSchema,
  });
  const duration = Date.now() - startTime;

  console.log(`⏱️  Extraction took ${duration}ms`);

  return result.object;
}

/**
 * List available prompts
 */
function listPrompts(): void {
  console.log("\n📋 Available system prompts:\n");
  for (const key of Object.keys(SYSTEM_PROMPTS)) {
    const label = key === DEFAULT_PROMPT_NAME ? PRODUCTION_PROMPT_LABEL : "";
    console.log(`  • ${key}${label}`);
  }
  console.log();
}

/**
 * Extract metadata for all prompts
 */
async function extractForAllPrompts(
  post: Doc<"posts">,
  promptNames: string[]
): Promise<Array<{ prompt: string; metadata: PostMetadataExtraction }>> {
  const results: Array<{ prompt: string; metadata: PostMetadataExtraction }> =
    [];

  for (const promptName of promptNames) {
    const prompt = SYSTEM_PROMPTS[promptName];
    if (!prompt) {
      console.warn(`⚠️  Unknown prompt: ${promptName}, skipping...`);
      continue;
    }

    console.log(`\n🧪 Testing: ${promptName}...`);
    try {
      const metadata = await extractMetadata(post, prompt);
      results.push({ prompt: promptName, metadata });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`❌ Error with ${promptName}:`, errorMessage);
    }
  }

  return results;
}

/**
 * Print comparison summary
 */
function printComparisonSummary(
  results: Array<{ prompt: string; metadata: PostMetadataExtraction }>
): void {
  console.log("\n");
  printSeparator();
  console.log("COMPARISON RESULTS");
  printSeparator();

  console.log("\n📊 Event Score Comparison:");
  console.log("-".repeat(OUTPUT_WIDTH));
  for (const { prompt, metadata } of results) {
    console.log(
      `  ${prompt.padEnd(PROMPT_NAME_PADDING)}: ${metadata.event_score}/${MAX_EVENT_SCORE}`
    );
  }

  console.log("\n📅 Date Extraction:");
  console.log("-".repeat(OUTPUT_WIDTH));
  for (const { prompt, metadata } of results) {
    const dateStr = metadata.event_date_start
      ? formatTimestamp(metadata.event_date_start)
      : "N/A";
    console.log(`  ${prompt.padEnd(PROMPT_NAME_PADDING)}: ${dateStr}`);
  }

  console.log("\n📍 Location Extraction:");
  console.log("-".repeat(OUTPUT_WIDTH));
  for (const { prompt, metadata } of results) {
    console.log(
      `  ${prompt.padEnd(PROMPT_NAME_PADDING)}: ${metadata.location || "N/A"}`
    );
  }

  console.log("\n🎫 Event Type:");
  console.log("-".repeat(OUTPUT_WIDTH));
  for (const { prompt, metadata } of results) {
    console.log(
      `  ${prompt.padEnd(PROMPT_NAME_PADDING)}: ${metadata.event_type || "N/A"}`
    );
  }
}

/**
 * Print detailed results for all prompts
 */
function printDetailedResults(
  results: Array<{ prompt: string; metadata: PostMetadataExtraction }>,
  caption: string
): void {
  console.log("\n");
  printSeparator();
  console.log("DETAILED RESULTS");
  printSeparator();
  for (const { prompt, metadata } of results) {
    console.log(`\n📋 Prompt: ${prompt}`);
    printMetadata(metadata, caption);
  }
}

/**
 * Compare multiple prompts
 */
async function comparePrompts(
  post: Doc<"posts">,
  promptNames: string[]
): Promise<void> {
  console.log("\n🔬 COMPARING PROMPTS");
  printSeparator();
  const captionPreview =
    post.caption.length > CAPTION_PREVIEW_LENGTH
      ? `${post.caption.substring(0, CAPTION_PREVIEW_LENGTH)}...`
      : post.caption;
  console.log(`Caption: ${captionPreview}\n`);

  const results = await extractForAllPrompts(post, promptNames);
  printComparisonSummary(results);
  printDetailedResults(results, post.caption);
}

/**
 * Process a single post
 */
async function processPost(
  post: Doc<"posts">,
  promptName: string
): Promise<void> {
  const systemPrompt = SYSTEM_PROMPTS[promptName];
  if (!systemPrompt) {
    console.error(`❌ Unknown prompt: ${promptName}`);
    const available = Object.keys(SYSTEM_PROMPTS).join(", ");
    console.error(`Available prompts: ${available}`);
    console.error("Use --list-prompts to see all prompts");
    process.exit(1);
  }

  printPostInfo(post);

  const captionPreview =
    post.caption.length > CAPTION_PREVIEW_LENGTH
      ? `${post.caption.substring(0, CAPTION_PREVIEW_LENGTH)}...`
      : post.caption;

  console.log("\n🧪 Testing metadata extraction");
  console.log(`📋 Prompt: ${promptName}`);
  console.log(`📝 Caption: ${captionPreview}\n`);

  try {
    const metadata = await extractMetadata(post, systemPrompt);
    printMetadata(metadata, post.caption);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("❌ Error:", errorMessage);
    process.exit(1);
  }
}

/**
 * Handle compare mode
 */
async function handleCompareMode(
  args: string[],
  client: ConvexHttpClient
): Promise<boolean> {
  const compareIndex = args.indexOf("--compare");
  if (compareIndex === -1 || !args[compareIndex + 1]) {
    return false;
  }

  const promptNamesStr = args[compareIndex + 1];
  if (!promptNamesStr) {
    console.error("❌ --compare requires prompt names");
    process.exit(1);
  }
  const promptNames = promptNamesStr.split(",").map((p) => p.trim());

  const postIdIndex = args.indexOf("--post-id");
  if (postIdIndex === -1 || !args[postIdIndex + 1]) {
    console.error("❌ --compare requires --post-id");
    process.exit(1);
  }

  const postId = args[postIdIndex + 1];
  if (!postId) {
    console.error("❌ Invalid post ID");
    process.exit(1);
  }
  const post = await fetchPostById(client, postId);
  if (!post) {
    console.error(`❌ Post not found: ${postId}`);
    process.exit(1);
  }

  printPostInfo(post);
  await comparePrompts(post, promptNames);
  return true;
}

/**
 * Handle fetch recent posts mode
 */
async function handleFetchRecentMode(
  args: string[],
  client: ConvexHttpClient,
  promptName: string
): Promise<boolean> {
  const fetchRecentIndex = args.indexOf("--fetch-recent");
  if (fetchRecentIndex === -1) {
    return false;
  }

  const limitArg = fetchRecentIndex !== -1 ? args[fetchRecentIndex + 1] : null;
  const limit = limitArg ? Number.parseInt(limitArg, 10) : DEFAULT_FETCH_LIMIT;

  console.log(`\n📥 Fetching ${limit} recent posts...\n`);
  const posts = await fetchRecentPosts(client, limit);
  if (posts.length === 0) {
    console.log("No posts found.");
    return true;
  }

  for (const post of posts) {
    printSeparator();
    await processPost(post, promptName);
  }
  return true;
}

/**
 * Handle fetch unsent posts mode
 */
async function handleFetchUnsentMode(
  args: string[],
  client: ConvexHttpClient,
  promptName: string
): Promise<boolean> {
  const fetchUnsentIndex = args.indexOf("--fetch-unsent");
  if (fetchUnsentIndex === -1) {
    return false;
  }

  const limitArg = fetchUnsentIndex !== -1 ? args[fetchUnsentIndex + 1] : null;
  const limit = limitArg ? Number.parseInt(limitArg, 10) : DEFAULT_FETCH_LIMIT;

  console.log(`\n📥 Fetching ${limit} unsent posts...\n`);
  const posts = await fetchUnsentPosts(client, limit);
  if (posts.length === 0) {
    console.log("No unsent posts found.");
    return true;
  }

  for (const post of posts) {
    printSeparator();
    await processPost(post, promptName);
  }
  return true;
}

/**
 * Handle single post mode
 */
async function handleSinglePostMode(
  args: string[],
  client: ConvexHttpClient,
  promptName: string
): Promise<void> {
  const postIdIndex = args.indexOf("--post-id");
  if (postIdIndex === -1 || !args[postIdIndex + 1]) {
    console.error(
      "❌ Please provide --post-id, --fetch-recent, or --fetch-unsent"
    );
    console.error("Use --help for usage information");
    process.exit(1);
  }

  const postId = args[postIdIndex + 1];
  if (!postId) {
    console.error("❌ Invalid post ID");
    process.exit(1);
  }
  const post = await fetchPostById(client, postId);
  if (!post) {
    console.error(`❌ Post not found: ${postId}`);
    process.exit(1);
  }

  await processPost(post, promptName);
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Help
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
🧪 Metadata Extraction Tester

Usage:
  bun test-metadata-extraction.ts [options]

Options:
  --post-id <id>         Test extraction on a specific post by ID
  --fetch-recent <n>     Fetch and test the N most recent posts (default: ${DEFAULT_FETCH_LIMIT})
  --fetch-unsent <n>     Fetch and test N unsent posts (default: ${DEFAULT_FETCH_LIMIT})
  --prompt <name>        Use a specific system prompt (default: ${DEFAULT_PROMPT_NAME})
  --compare <p1,p2,...>  Compare multiple prompts (comma-separated)
  --list-prompts         List all available prompts
  --help, -h             Show this help

Environment Variables:
  CONVEX_URL              Required for fetching posts
  GOOGLE_GENERATIVE_AI_API_KEY  Required for AI extraction

Examples:
  bun test-metadata-extraction.ts --post-id j1234567890abcdef
  bun test-metadata-extraction.ts --post-id j1234567890abcdef --prompt strict
  bun test-metadata-extraction.ts --compare default,strict,aggressive --post-id j1234567890abcdef
  bun test-metadata-extraction.ts --fetch-recent 3
  bun test-metadata-extraction.ts --list-prompts
`);
    return;
  }

  // List prompts
  if (args.includes("--list-prompts")) {
    listPrompts();
    return;
  }

  // Get Convex client
  let client: ConvexHttpClient;
  try {
    client = getConvexClient();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to initialize Convex client: ${errorMessage}`);
    process.exit(1);
  }

  // Get prompt name
  const promptIndex = args.indexOf("--prompt");
  const promptNameArg =
    promptIndex !== -1 && args[promptIndex + 1] ? args[promptIndex + 1] : null;
  const promptName: string = promptNameArg || DEFAULT_PROMPT_NAME;

  // Handle different modes
  if (await handleCompareMode(args, client)) {
    return;
  }
  if (await handleFetchRecentMode(args, client, promptName)) {
    return;
  }
  if (await handleFetchUnsentMode(args, client, promptName)) {
    return;
  }

  // Single post mode (default)
  await handleSinglePostMode(args, client, promptName);
}

// Run if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
