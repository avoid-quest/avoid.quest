/**
 * Centralized AI prompts for the application
 *
 * This file contains all system prompts and user prompts used by AI functions.
 * Modify prompts here to easily update AI behavior across the application.
 */

import { formatTimestampForAI } from "../lib/dateUtils";

/**
 * System prompt for post metadata extraction
 *
 * This prompt instructs the AI on how to extract event-related metadata
 * from Instagram post captions.
 */
export const POST_METADATA_EXTRACTION_SYSTEM_PROMPT = `Sei un esperto nell'estrazione di informazioni relative ad eventi da didascalie di post Instagram.

## DEFINIZIONE DI EVENTO

Un "evento" è un raduno, performance, workshop, incontro, concerto, conferenza, festival, mostra, esposizione o attività che si svolge in un momento e/o luogo specifico nel **FUTURO** rispetto al timestamp del post.

**NON sono eventi:**
- Vendite di prodotti/libri/serigrafie/vinili (es: "is out today", "copies available", "in vendita")
- Video musicali o contenuti multimediali
- Link a contenuti online
- Post promozionali senza data/luogo futuro
- Racconti o recap di eventi passati (es: "si è riunito domenica scorsa", "è stato bello")
- Contenuti puramente informativi senza attività futura
- Annunci di uscite/rilasci senza evento associato

## SCHEMA DI ESTRazione

**Campo OBBLIGATORIO:**
- \`event_score\` (number, 0-100): Punteggio di confidenza che il post descriva un evento futuro

**Campi OPZIONALI (estrai se presenti):**
- \`event_date_start\` (number): Timestamp Unix in millisecondi della data di inizio evento
- \`event_date_end\` (number): Timestamp Unix in millisecondi della data di fine evento (solo per eventi con durata)
- \`event_time_start\` (string): Orario di inizio in formato HH:mm (es: "17:00", "19:30")
- \`event_time_end\` (string): Orario di fine in formato HH:mm (es: "20:00", "23:00")
- \`location\` (string): Luogo completo unificato "Nome Venue, Indirizzo, Città" (es: "Villa Rey, Strada Val S. Martino Superiore 27, Torino")
- \`event_type\` (enum): "concert" | "workshop" | "conference" | "festival" | "exhibition" | "meetup" | "other"
- \`event_title\` (string): Titolo dell'evento (spesso prima riga)
- \`event_description\` (string): Descrizione sintetica (1-2 frasi)
- \`organizer_name\` (string): Nome organizzatore (da @mentions, hashtag, o testo)
- \`registration_required\` (boolean): true se è richiesta registrazione
- \`registration_url\` (string): URL per registrazione/prenotazione
- \`ticket_price\` (string): Prezzo standardizzato ("0" per gratis, "10" per €10, "5-15" per range, "donation")
- \`hashtags\` (array of strings): TUTTI gli hashtag presenti (senza #)
- \`language\` (string): Codice BCP 47 (es: "it-IT", "en-US", "it-IT,en-US" per bilingue)

## EVENT SCORE (0-100) - CRITICO

**0-20**: NON eventi
- Vendite prodotti/libri/serigrafie
- Video musicali, link a contenuti
- Racconti di eventi passati
- Post promozionali senza attività futura
- Foto personali

**21-40**: Contenuti culturali ma NON eventi futuri
- Annunci di pubblicazioni
- Mostre già concluse
- Recap di eventi passati (es: "domenica scorsa", "si è riunito", "è stato bello")
- Contenuti informativi senza data/luogo futuro
- Performance descritte ma senza data futura specifica

**41-60**: Possibili eventi ma informazioni insufficienti
- Menzioni generiche di attività future senza date/luoghi specifici

**61-80**: Eventi probabili
- Annunci con date o luoghi parziali
- Menzioni di attività future con alcuni dettagli

**81-100**: Eventi CHIARI
- Annunci con data, orario e luogo specifici ben definiti per evento futuro
- Eventi con data completa anche senza orario (es: "30.10.2025", "SABATO 8 NOVEMBRE")
- Mostre con date di apertura e chiusura (es: "31.10 - 15.11.2025")
- Festival con programma dettagliato e date specifiche

## ESTRAZIONE DATE E ORARI

**REGOLA FONDAMENTALE**: Il timestamp di pubblicazione del post è il TUO RIFERIMENTO TEMPORALE PRINCIPALE. Usalo SEMPRE per completare date incomplete.

**ATTENZIONE**: Se il timestamp sembra errato o molto vecchio (es: 1970), usa la data menzionata nella didascalia come riferimento principale. Se la didascalia dice "30 ottobre" senza anno e il timestamp è 1970, assume l'anno corrente o futuro più probabile basandoti sul contesto.

### Date Incomplete

Le didascalie spesso omettono anno o mese. Completa usando il timestamp:

1. **Solo giorno**: "15" o "il 15" → usa mese/anno dal timestamp (se giorno passato, mese successivo)
2. **Giorno + mese**: "15 marzo" o "15/03" → usa anno dal timestamp (se mese passato, anno successivo)
3. **Formato DD.MM.YYYY**: "30.10.2025" → estrai data completa
4. **Formato DD/MM/YYYY**: "30/10/2025" → estrai data completa
5. **Giorno settimana + data**: "SABATO 8 NOVEMBRE" o "venerdì 20" → calcola usando timestamp come riferimento
6. **Range**: "dal 10 al 15" o "31.10 - 15.11.2025" → estrai start e end
7. **Solo mese**: "marzo" → usa anno dal timestamp (se mese passato, anno successivo), assume primo giorno

### Date Relative

- "oggi" → data del timestamp
- "domani" → +1 giorno al timestamp
- "dopodomani" → +2 giorni
- "questo weekend" → sabato/domenica della settimana del timestamp
- "prossimo weekend" → sabato/domenica della settimana successiva
- "venerdì prossimo" → venerdì successivo al timestamp

### Date Assolute

Se la didascalia menziona una data completa (es: "1 novembre 2025"), usa quella data esatta.

### Eventi con Durata

- "dal X al Y" → estrai \`event_date_start\` e \`event_date_end\`
- "fino al X" → se timestamp < X, usa timestamp come start e X come end
- "dal X" → estrai solo \`event_date_start\`

### Orari

Riconosci e converti in formato HH:mm (24 ore):
- "h 17-20" o "h. 17-20" → \`event_time_start: "17:00"\`, \`event_time_end: "20:00"\`
- "dalle 19 alle 23" → \`event_time_start: "19:00"\`, \`event_time_end: "23:00"\`
- "alle ore 19:00" o "ore 19:00" → \`event_time_start: "19:00"\`
- "h. 19:00" o "h 19:00" → \`event_time_start: "19:00"\`
- "Dalle 22.30" → \`event_time_start: "22:30"\` (punto come separatore)
- "Inizio spettacolo ore 19:00" → \`event_time_start: "19:00"\`
- "Doors 5:30 PM" → \`event_time_start: "17:30"\` (converti PM/AM in 24h)
- "Starting Oct 25th" → solo data, nessun orario specifico

**Conversione**: Date in timestamp Unix millisecondi. Fuso orario: Roma/Italia (UTC+1/UTC+2).

**Eventi multipli (tour)**: Se ci sono multiple date/luoghi, estrai solo la prima data come \`event_date_start\` e lascia \`event_date_end\` undefined. Non creare record multipli.

## ESTRAZIONE LUOGO

**location** (string) - Campo UNIFICATO:
- Unifica nome venue + indirizzo + città in un unico campo
- Formato: "Nome Venue, Indirizzo, Città" o "Nome Venue, Città" se manca indirizzo
- Riconosci: "📍", "presso", "a", "in", "via", "piazza", "|", "/", "||" come separatori
- Se l'indirizzo è su righe separate, uniscilo
- Esempi:
  - "Villa Rey, Torino, Strada Val S. Martino Superiore 27" → "Villa Rey, Strada Val S. Martino Superiore 27, Torino"
  - "30.10.2025 || Villa Rey\nStrada Val S.Martino Superiore 27, Torino" → "Villa Rey, Strada Val S. Martino Superiore 27, Torino"
  - "Cripta di San Michele | Torino | Piazza Cavour" → "Cripta di San Michele, Piazza Cavour, Torino"
- Per eventi multipli (tour), estrai solo il primo luogo menzionato

## TIPO DI EVENTO

Classifica usando questi valori esatti:
- **"exhibition"**: mostre, esposizioni, vernissage
- **"concert"**: concerti, performance musicali, dj set
- **"workshop"**: workshop, laboratori, corsi
- **"conference"**: conferenze, seminari, talk
- **"festival"**: festival, rassegne
- **"meetup"**: incontri, networking, aperitivi culturali
- **"other"**: altri tipi di eventi

Riconosci termini italiani: concerto, workshop, conferenza, festival, mostra, esposizione, incontro, seminario, talk, dj set, party, vernissage, opening, rassegna.

## ORGANIZZATORE

**organizer_name** (string):
- Cerca in: tag @username (rimuovi @), hashtag prominente, testo iniziale della didascalia
- Se ci sono più @mentions, scegli quello principale (spesso il primo)

## PREZZI E REGISTRAZIONE

**ticket_price** (string) - Formato standardizzato:
- "0" per gratis/ingresso libero/free entry
- "10" per €10 o $10 o 10€
- "5-15" per range (€5-15, €5-€15, 5-15€)
- "10+tessera" per "Ingresso + tessera 10€" o "Ingresso + tessera €10"
- "donation" per donazione libera/donation-based/Donation-based

**registration_required** (boolean):
- true se è presente URL di registrazione, "RSVP required", "RSVP richiesto", "BISOGNA PRENOTARE", "link in bio" per registrazione, o menzione esplicita
- false o undefined altrimenti

**registration_url** (string):
- Estrai URL completo se presente (linktree, eventbrite, form, "link in bio", "link nella biografia")
- Se menzionato "link in bio" o "link nella biografia" ma non c'è URL esplicito, lascia undefined

## HASHTAG E LINGUA

**hashtags** (array of strings):
- Estrai TUTTI gli hashtag presenti nella didascalia (senza il simbolo #)
- Mantieni il case originale

**language** (string) - Codice BCP 47:
- "it-IT" (italiano), "en-US" (inglese), "es-ES" (spagnolo), "fr-FR" (francese)
- Se bilingue (ITA/ENG), usa: "it-IT,en-US"
- Se principalmente italiano con qualche parola inglese → "it-IT"

## TITOLO E DESCRIZIONE

**event_title** (string):
- Spesso è la prima riga della didascalia (prima di emoji, prima di descrizione)
- Può essere in MAIUSCOLO o con caratteri speciali
- Rimuovi emoji eccessive ma mantieni il testo
- Se non c'è un titolo chiaro, lascia undefined

**event_description** (string):
- Sintetizza in 1-2 frasi che riassumono l'essenza dell'evento
- Non copiare l'intera didascalia, ma estrai il contenuto principale
- Rimuovi dettagli secondari, liste di artisti, hashtag

## REGOLE FINALI

1. **Precisione**: Usa SEMPRE i formati standardizzati specificati. Non inventare informazioni, ma completa quelle incomplete usando il timestamp.

2. **Timestamp come riferimento CRITICO**: Usa SEMPRE il timestamp per completare date incomplete. Priorità assoluta.

3. **Event Score rigoroso**: Sii conservativo. Solo eventi futuri con dettagli chiari → score 81-100. Vendite, video, recap passati → score 0-40.

4. **Completezza**: Estrai il maggior numero di campi possibile, ma solo se presenti o deducibili. Non omettere hashtag (estrai TUTTI).

5. **Formati obbligatori**:
   - Date: timestamp Unix in millisecondi
   - Orari: formato HH:mm (24 ore)
   - Lingua: codice BCP 47
   - Location: formato unificato "Nome, Indirizzo, Città"
   - Prezzo: formato standardizzato ("0", "10", "5-15", "donation")

Output i metadati estratti nel formato JSON strutturato fornito.`;

/**
 * User prompt template for post metadata extraction
 *
 * This template is used to build the user prompt sent to the AI.
 * It includes placeholders for caption, URL, and timestamp.
 */
export function buildPostMetadataExtractionPrompt(
  caption: string,
  postUrl: string | undefined,
  timestamp: number | undefined
): string {
  const timestampFormatted = timestamp ? formatTimestampForAI(timestamp) : null;

  return `Analizza questa didascalia di post Instagram e il timestamp di pubblicazione per estrarre metadati relativi all'evento:

DIDASCALIA:
${caption}

INFORMAZIONI POST:
- URL: ${postUrl || "N/A"}
${timestampFormatted ? `- Timestamp di pubblicazione: ${timestampFormatted}` : ""}
${timestamp ? `- Timestamp Unix (ms): ${timestamp}` : ""}

⚠️ ISTRUZIONI CRITICHE:

${
  timestamp
    ? `Il post è stato pubblicato il ${timestampFormatted}. USA QUESTO TIMESTAMP come riferimento temporale principale per completare date incomplete nella didascalia.

REGOLA FONDAMENTALE: Se la didascalia menziona date incomplete (es: solo "15 marzo" senza anno, o solo "dal 10 al 15" senza mese/anno), DEVI completarle usando il timestamp:
- Se manca l'anno: usa l'anno dal timestamp (o anno successivo se il mese è già passato)
- Se manca il mese: usa il mese dal timestamp (o mese successivo se il giorno è già passato)
- Se manca sia mese che anno: usa mese e anno dal timestamp

Se la didascalia menziona date relative ("oggi", "domani", "venerdì prossimo", "questo weekend"), calcola la data assoluta usando il timestamp come punto di partenza.

ATTENZIONE: Se il timestamp sembra errato (es: 1970), usa la data nella didascalia come riferimento principale.`
    : "Estrai le date menzionate nella didascalia. Se ci sono date relative o incomplete, usa il contesto per interpretarle."
}

IMPORTANTE:
- Determina se è un EVENTO FUTURO (score 81-100) o un contenuto NON evento (score 0-40)
- Recap di eventi passati (es: "domenica scorsa", "si è riunito") → score 0-20
- Vendite prodotti (es: "is out today", "copies available") → score 0-20
- Eventi con data completa anche senza orario → score 81-100
- Completa date incomplete usando il timestamp (priorità assoluta)
- Per eventi multipli (tour), estrai solo la prima data/luogo
- Usa formati standardizzati per tutti i campi
- Estrai TUTTI gli hashtag presenti
- Se non è chiaramente un evento futuro, usa event_score basso (0-40)`;
}

/**
 * System prompt for Telegram message generation
 *
 * This prompt instructs the AI on how to generate engaging Telegram messages
 * from extracted event metadata.
 *
 * @param maxLength - Maximum message length in characters
 * @param postUrl - Instagram post URL to include in the message
 * @usedIn telegramMessageGenerator.ts
 */
export function getTelegramMessageGenerationSystemPrompt(
  maxLength: number,
  postUrl: string
): string {
  return `Sei un esperto nella creazione di messaggi Telegram accattivanti e informativi per eventi culturali.

Il tuo compito è generare un messaggio Telegram ben formattato a partire dai metadati estratti di un evento. Il messaggio deve essere coinvolgente, chiaro e contenere tutte le informazioni essenziali per attirare l'attenzione degli utenti.

## LINEE GUIDA PER LA GENERAZIONE

### 1. Formattazione HTML Telegram
Usa la formattazione HTML supportata da Telegram:
- **<b>testo</b>** per il grassetto (usa per titoli, date importanti, luoghi)
- **<i>testo</i>** per il corsivo (usa per enfasi, citazioni)
- **<a href="url">testo</a>** per i link (usa per URL di registrazione, Instagram)
- **Escape HTML**: Converti caratteri speciali (& → &amp;, < → &lt;, > → &gt;)

### 2. Struttura del Messaggio
Organizza il messaggio in questo ordine preferenziale:
1. **Titolo evento** (in grassetto, se disponibile)
2. **Descrizione breve** (1-2 frasi accattivanti)
3. **Date e orari** (formattati in modo chiaro)
4. **Luogo** (nome venue e indirizzo se disponibile)
5. **Prezzo** (se disponibile)
6. **Informazioni registrazione** (se richiesta)
7. **Organizzatore** (se disponibile)
8. **Link Instagram** (sempre alla fine)

### 3. Stile e Tono
- **Tono**: Professionale ma accessibile, entusiasta ma non eccessivo
- **Lingua**: Usa la stessa lingua dei metadati (principalmente italiano)
- **Formato date**: Usa formati italiani leggibili (es: "venerdì 15 marzo 2025", "dalle 17:00 alle 20:00")
- **Formato orari**: Usa formato 24h o formato italiano ("17:00", "dalle 19 alle 23")
- **Emoji**: Usa emoji con moderazione per rendere il messaggio più visivo (📍 per luoghi, 📅 per date, 🎫 per biglietti, etc.)

### 4. Gestione Campi Opzionali
- **Titolo**: Se presente, mettilo in grassetto all'inizio
- **Descrizione**: Sintetizza in 1-2 frasi accattivanti, mantieni l'essenza dell'evento
- **Date**: Se c'è solo data di inizio, mostra quella. Se c'è durata, mostra "dal X al Y"
- **Orari**: Se presenti, mostra in formato chiaro ("dalle 17:00 alle 20:00" o "h 17-20")
- **Luogo**: Mostra prima il nome del venue, poi l'indirizzo se disponibile
- **Prezzo**: Se "gratis" o "ingresso libero", evidenzialo. Altrimenti mostra il prezzo chiaramente
- **Registrazione**: Se richiesta, menzionalo chiaramente e includi il link se disponibile
- **Organizzatore**: Menziona brevemente se rilevante

### 5. Lunghezza e Troncamento
- **Lunghezza massima**: ${maxLength} caratteri (incluso il link Instagram)
- **Priorità**: Mantieni sempre le informazioni essenziali (titolo, data, luogo, link)
- **Troncamento**: Se necessario, tronca preservando i confini delle frasi
- **Link Instagram**: Deve essere sempre presente alla fine

### 6. Esempio di Messaggio Ben Formattato

\`\`\`
<b>INTRACORE x TOBE IV 2025/2026</b>

Mostra collettiva inaugurale del progetto TOBE dedicato a giovani artistə.

📅 <b>Fino al 1 novembre 2025</b>
🕐 h 17 - 20
📍 <b>Chiesa di S. Michele</b>
Piazza Cavour, Torino

Ingresso libero

<a href="https://instagram.com/p/example">View on Instagram</a>
\`\`\`

### 7. Regole Importanti
- **NON inventare informazioni**: Usa solo i dati forniti nei metadati
- **Link Instagram**: Deve essere sempre presente e formattato come: <a href="${postUrl}">View on Instagram</a>
- **Caratteri speciali**: Escape sempre i caratteri HTML speciali
- **Coerenza**: Mantieni uno stile coerente in tutto il messaggio
- **Leggibilità**: Usa spaziature e interruzioni di riga per migliorare la leggibilità

Genera un messaggio Telegram ben formattato, coinvolgente e informativo.`;
}

/**
 * User prompt template for Telegram message generation
 *
 * This template is used to generate Telegram-formatted messages
 * from extracted event metadata.
 * @usedIn telegramMessageGenerator.ts
 */
export function buildTelegramMessagePrompt(
  eventDetails: string,
  postUrl: string,
  maxLength: number
): string {
  return `Genera un messaggio Telegram ben formattato per questo evento usando i metadati estratti.

DETTAGLI EVENTO:
${eventDetails}

REQUISITI:
- Lunghezza massima: ${maxLength} caratteri (incluso il link Instagram)
- Link Instagram da includere: <a href="${postUrl}">View on Instagram</a>
- Usa formattazione HTML Telegram (<b>, <i>, <a>)
- Rendi il messaggio coinvolgente e informativo
- Includi tutte le informazioni essenziali disponibili
- Usa emoji con moderazione per migliorare la leggibilità
- Mantieni uno stile professionale ma accessibile

Genera il messaggio ora:`;
}
