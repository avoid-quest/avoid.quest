import type { Doc } from "@workspace/backend/convex/_generated/dataModel";

/**
 * Test fixtures based on real problematic posts that have caused issues.
 * These are anonymized examples that represent common failure patterns.
 */

/**
 * Post with HTML parsing error - unclosed tags
 * Based on error: "can't parse entities: Unexpected end tag at byte offset 290"
 */
export const postWithHtmlParsingError: Partial<Doc<"posts">> = {
  caption:
    "Check out this amazing post! <a href='https://instagram.com/user'>@user</a> and <a href='https://instagram.com/another'>@another",
  url: "https://instagram.com/p/test123",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with very long caption that needs truncation
 */
const LONG_CAPTION_REPEAT_COUNT = 2000;
export const postWithLongCaption: Partial<Doc<"posts">> = {
  caption:
    "A".repeat(LONG_CAPTION_REPEAT_COUNT) +
    " This is a very long caption that should be truncated properly while preserving the Instagram link at the end.",
  url: "https://instagram.com/p/test456",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with multiple @ mentions
 */
export const postWithManyMentions: Partial<Doc<"posts">> = {
  caption:
    "Thanks @user1 @user2 @user3 @user4 @user5 for the amazing collaboration! Check out @user6 and @user7 too!",
  url: "https://instagram.com/p/test789",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with special characters that need escaping
 */
export const postWithSpecialCharacters: Partial<Doc<"posts">> = {
  caption:
    "This post has <tags> & \"quotes\" and 'apostrophes' that need to be escaped properly!",
  url: "https://instagram.com/p/test101",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with expired Instagram CDN URLs (403 errors)
 * Based on real error patterns from logs
 */
export const postWithExpiredUrls: Partial<Doc<"posts">> = {
  caption: "Check out this carousel post!",
  url: "https://instagram.com/p/test202",
  media_type: "carousel",
  is_video: false,
  display_url:
    "https://scontent-fco2-1.cdninstagram.com/v/t51.2885-15/565988906_17869810590450672_7303141716025321181_n.heic?stp=dst-jpg_e35_p1080x1080_sh0.08_tt6&_nc_ht=scontent-fco2-1.cdninstagram.com&_nc_cat=100&_nc_oc=Q6cZ2QGAMgiI9T55G4YqI4ckDPFprgWoFUDQfWUvMz40Kp6D6e-MPpqyEFW30MY0KdmsMjU&_nc_ohc=lYlJBa3ta4MQ7kNvwFIQydc&_nc_gid=pfMbEzFiaIf1JGDDPDRc_g&edm=AOQ1c0wBAAAA&ccb=7-5&ig_cache_key=Mzc0NDkyMTMxNTA3ODYyMjgxNQ%3D%3D.3-ccb7-5&oh=00_Afi4leBCEVTfBcxtRKD1XRG60hQDI7fcIUHnDqx_aVb1XA&oe=690D0FED&_nc_sid=8b3546",
  sent: false,
};

/**
 * Post with malformed HTML in caption
 */
export const postWithMalformedHtml: Partial<Doc<"posts">> = {
  caption:
    "Check this out! <a href='https://instagram.com/user'>@user</a> <a href='https://instagram.com/another'>@another</a> <a href='https://instagram.com/broken",
  url: "https://instagram.com/p/test303",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with empty caption
 */
export const postWithEmptyCaption: Partial<Doc<"posts">> = {
  caption: "",
  url: "https://instagram.com/p/test404",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with caption that has existing HTML links
 */
export const postWithExistingHtmlLinks: Partial<Doc<"posts">> = {
  caption:
    'Visit <a href="https://instagram.com/existing">@existing</a> and also check @newuser',
  url: "https://instagram.com/p/test505",
  media_type: "image",
  is_video: false,
  display_url: "https://example.com/image.jpg",
  sent: false,
};

/**
 * Post with carousel media (multiple images)
 */
export const postWithCarouselMedia: Partial<Doc<"posts">> = {
  caption: "Check out this carousel with multiple images!",
  url: "https://instagram.com/p/test606",
  media_type: "carousel",
  is_video: false,
  display_url: "https://example.com/image1.jpg",
  sent: false,
};

/**
 * Post with video
 */
export const postWithVideo: Partial<Doc<"posts">> = {
  caption: "Amazing video content!",
  url: "https://instagram.com/p/test707",
  media_type: "video",
  is_video: true,
  display_url: "https://example.com/thumbnail.jpg",
  video_url: "https://example.com/video.mp4",
  thumbnail_url: "https://example.com/thumbnail.jpg",
  sent: false,
};

/**
 * Media items for carousel post (expired URLs that return 403)
 */
export const expiredMediaItems = [
  {
    url: "https://scontent-fco2-1.cdninstagram.com/v/t51.2885-15/565988906_17869810590450672_7303141716025321181_n.heic?stp=dst-jpg_e35_p1080x1080_sh0.08_tt6&_nc_ht=scontent-fco2-1.cdninstagram.com&_nc_cat=100&_nc_oc=Q6cZ2QGAMgiI9T55G4YqI4ckDPFprgWoFUDQfWUvMz40Kp6D6e-MPpqyEFW30MY0KdmsMjU&_nc_ohc=lYlJBa3ta4MQ7kNvwFIQydc&_nc_gid=pfMbEzFiaIf1JGDDPDRc_g&edm=AOQ1c0wBAAAA&ccb=7-5&ig_cache_key=Mzc0NDkyMTMxNTA3ODYyMjgxNQ%3D%3D.3-ccb7-5&oh=00_Afi4leBCEVTfBcxtRKD1XRG60hQDI7fcIUHnDqx_aVb1XA&oe=690D0FED&_nc_sid=8b3546",
    type: "image" as const,
    width: 1080,
    height: 1080,
  },
  {
    url: "https://scontent-fco2-1.cdninstagram.com/v/t51.2885-15/566854497_17869810599450672_2491548246561218383_n.heic?stp=dst-jpg_e35_p1080x1080_sh0.08_tt6&_nc_ht=scontent-fco2-1.cdninstagram.com&_nc_cat=100&_nc_oc=Q6cZ2QGAMgiI9T55G4YqI4ckDPFprgWoFUDQfWUvMz40Kp6D6e-MPpqyEFW30MY0KdmsMjU&_nc_ohc=fezMEr_c620Q7kNvwGUMqaE&_nc_gid=pfMbEzFiaIf1JGDDPDRc_g&edm=AOQ1c0wBAAAA&ccb=7-5&ig_cache_key=Mzc0NDkyMTMxNTE1NDA4MDUxNA%3D%3D.3-ccb7-5&oh=00_AfgACJEKAJGnlc17hwnae1SZ162uy4THO4YvQ1eyDUdcvQ&oe=690D2CB2&_nc_sid=8b3546",
    type: "image" as const,
    width: 1080,
    height: 1080,
  },
];
