import { Agent } from "@convex-dev/agent";
import { google } from "@ai-sdk/google";
import { z } from "zod";

// Define the schema matching post_metadata table structure
const postMetadataSchema = z.object({
  event_score: z.number().min(0).max(100).describe("AI confidence this is an event (0-100)"),
  event_date_start: z.number().optional().describe("Start date/time as timestamp"),
  event_date_end: z.number().optional().describe("End date/time as timestamp (for multi-day events)"),
  event_time_start: z.string().optional().describe("Start time (e.g., '19:00', '7:00 PM')"),
  event_time_end: z.string().optional().describe("End time"),
  location: z.string().optional().describe("Venue/location name"),
  location_address: z.string().optional().describe("Full address if available"),
  location_coordinates: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional().describe("Geocoded coordinates"),
  event_type: z.enum(["concert", "workshop", "conference", "festival", "exhibition", "meetup", "other"]).optional().describe("Event category"),
  event_title: z.string().optional().describe("Extracted event name/title"),
  organizer_name: z.string().optional().describe("Event organizer/host"),
  organizer_contact: z.string().optional().describe("Contact info (email, phone, social handle)"),
  target_audience: z.array(z.string()).optional().describe("Audience tags (e.g., ['professionals', 'students'])"),
  registration_required: z.boolean().optional().describe("Whether registration needed"),
  registration_url: z.string().optional().describe("Registration link"),
  ticket_price: z.string().optional().describe("Price info (e.g., 'Free', '$20', '€15-30')"),
  event_description: z.string().optional().describe("Cleaned/summarized description"),
  hashtags: z.array(z.string()).optional().describe("Relevant hashtags extracted"),
  keywords: z.array(z.string()).optional().describe("Key terms for searchability"),
  language: z.string().optional().describe("Detected language code (e.g., 'en', 'it', 'es')"),
  content_type: z.enum(["event_announcement", "event_reminder", "event_recap", "other"]).optional().describe("Type of content"),
});

export type PostMetadataExtraction = z.infer<typeof postMetadataSchema>;

const systemInstructions = `You are an expert at extracting event-related information from Instagram post captions.

Your task is to analyze the post caption and extract structured metadata about events, if the post describes an event.

**What constitutes an event:**
- Gatherings, performances, workshops, meetups, concerts, conferences, festivals, exhibitions
- Any scheduled activity with a specific date, time, and/or location
- Both one-time and recurring events

**Key extraction guidelines:**
1. **Event Score (0-100)**: Determine your confidence that this post describes an event. Use 0-30 for non-events, 31-70 for possibly related content, 71-100 for clear events.

2. **Date/Time Parsing**: 
   - Assume Rome/Italy timezone (UTC+1/UTC+2) for event dates unless explicitly stated otherwise
   - Convert relative dates (e.g., "tomorrow", "next Friday") to absolute timestamps
   - Extract both date and time when available
   - For multi-day events, provide both start and end dates

3. **Location**: Extract venue names, addresses, and if possible, geocoded coordinates. Prefer full addresses when available.

4. **Event Details**: 
   - Categorize the event type accurately
   - Extract the event title/name
   - Identify organizers and contact information
   - Note registration requirements and ticket pricing
   - Extract relevant hashtags and keywords for searchability

5. **Language Detection**: Detect the primary language of the content.

6. **Content Type**: Determine if this is an announcement, reminder, recap, or other type of event-related content.

**Output Format:**
Provide structured JSON matching the schema. Only include fields where you have confident information. Leave optional fields undefined if not found.`;

export const postMetadataExtractorAgent = new Agent({
  name: "postMetadataExtractor",
  model: google("gemini-2.5-flash"),
  system: systemInstructions,
});

// Expose the structured extraction action
export const extractPostMetadata = postMetadataExtractorAgent.asObjectAction({
  name: "extractPostMetadata",
  schema: postMetadataSchema,
  description: "Extract event metadata from Instagram post caption",
});
