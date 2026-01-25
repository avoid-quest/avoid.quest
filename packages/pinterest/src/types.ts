export type PinImage = {
  width: number;
  height: number;
  url: string;
};

export type ImageSize = "170x" | "236x" | "474x" | "736x" | "orig";

/** Gallery-appropriate sizes (excludes square thumbnail 136x136) */
export const IMAGE_SIZES: ImageSize[] = [
  "170x",
  "236x",
  "474x",
  "736x",
  "orig",
];

export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = {
  "170x": "Very Low",
  "236x": "Low",
  "474x": "Medium",
  "736x": "High",
  orig: "Original",
};

export type PinResponse = {
  id: string;
  title: string;
  description: string;
  alt_text: string | null;
  link: string | null;
  domain: string;
  dominant_color: string;
  images: Record<ImageSize | "136x136", PinImage>;
  pinner: {
    username: string;
    full_name: string;
    id: string;
    image_small_url: string;
    image_large_url: string;
    type: string;
    is_ads_only_profile: boolean;
    ads_only_profile_site: string | null;
    blocked_by_me: boolean;
    explicitly_followed_by_me: boolean;
  };
  board: {
    name: string;
    url: string;
    id: string;
    type: string;
    layout: string;
    privacy: string;
    followed_by_me: boolean;
    is_collaborative: boolean;
    collaborated_by_me: boolean;
    image_thumbnail_url: string;
    owner: {
      username: string;
      full_name: string;
      id: string;
      image_small_url: string;
      image_large_url: string;
      type: string;
      is_ads_only_profile: boolean;
      ads_only_profile_site: string | null;
      blocked_by_me: boolean;
      explicitly_followed_by_me: boolean;
    };
  };
  // Content metadata
  grid_title: string;
  grid_description: string;
  description_html: string;
  created_at: string;
  type: string;
  method: string;
  privacy: string;
  // Media info
  is_video: boolean;
  is_playable: boolean;
  video_status: string | null;
  video_status_message: string | null;
  videos: unknown | null;
  image_signature: string;
  image_crop: {
    min_y: number;
    max_y: number;
  };
  // Engagement
  repin_count: number;
  comment_count: number;
  favorite_user_count: number;
  done_by_me: boolean;
  favorited_by_me: boolean;
  is_repin: boolean;
  reaction_counts: Record<string, number>;
  // Promotional
  is_promoted: boolean;
  is_downstream_promotion: boolean;
  is_native: boolean;
  promoted_is_removable: boolean;
  promoted_is_lead_ad: boolean;
  promoted_lead_form: unknown | null;
  promoter: unknown | null;
  campaign_id: string | null;
  sponsorship: unknown | null;
  is_quick_promotable: boolean;
  ad_match_reason: number;
  insertion_id: string | null;
  tracking_params: string;
  // Product/shopping
  is_stale_product: boolean;
  is_oos_product: boolean;
  is_eligible_for_related_products: boolean;
  is_eligible_for_pdp: boolean;
  is_eligible_for_web_closeup: boolean;
  is_whitelisted_for_tried_it: boolean;
  product_pin_data: unknown | null;
  shopping_flags: string[];
  price_value: number;
  price_currency: string;
  // Rich data
  rich_summary: {
    products: unknown[];
    type_name: string;
    actions: unknown[];
    url: string;
    display_name: string;
    display_description: string;
    id: string;
    site_name: string;
    type: string;
    favicon_link: string;
    favicon_images: { orig: string };
    apple_touch_icon_link: string;
    apple_touch_icon_images: { orig: string };
  } | null;
  // Misc
  access: string[];
  embed: unknown | null;
  carousel_data: unknown | null;
  call_to_action_text: string | null;
  attribution: unknown | null;
  native_creator: unknown | null;
  creator_analytics: unknown | null;
  manual_interest_tags: unknown | null;
  story_pin_data: unknown | null;
  story_pin_data_id: string | null;
  should_open_in_stream: boolean;
  has_required_attribution_provider: boolean;
  is_uploaded: boolean;
  debug_info_html: string | null;
  view_tags: string[];
  additional_hide_reasons: string[];
  comments: {
    uri: string;
    data: unknown[];
    bookmark: string | null;
  };
  aggregated_pin_data: {
    is_shop_the_look: boolean;
    creator_analytics: unknown | null;
    has_xy_tags: boolean;
    id: string;
    aggregated_stats: {
      saves: number;
      done: number;
    };
    did_it_data: {
      recommend_scores: Array<{ score: number; count: number }>;
      videos_count: number;
      details_count: number;
      responses_count: number;
      recommended_count: number;
      user_count: number;
      rating: number;
      tags: string[];
      type: string;
      images_count: number;
    };
  } | null;
};
