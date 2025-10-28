export type Post = {
  int_id: number;
  id: string | null;
  shortcode: string | null;
  display_url: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  is_video: boolean | null;
  url: string | null;
  media_type: "image" | "video" | "carousel" | null;
  timestamp: number | null;
  event_date: Date | null;
  sent: boolean | null;
  sentAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MediaItem = {
  id: number;
  url: string | null;
  type: "image" | "video" | "thumbnail" | null;
  width: number | null;
  height: number | null;
  post_id: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type User = {
  id: number;
  username: string;
  profile_url: string | null;
  to_be_scraped: boolean | null;
  last_scraped_at: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type Setting = {
  id: number;
  key: string;
  value: string;
  description: string | null;
  category: "cron" | "scraper" | "telegram" | "logging" | "general";
  isEditable: boolean | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type PostAndUser = {
  post_id: number;
  user_id: number;
  user_type: "owner" | "mentioned" | "tagged" | "collaborator";
  createdAt: Date | null;
};

export type Database = {
  posts_table: Post;
  media_items_table: MediaItem;
  users_table: User;
  settings_table: Setting;
  post_users_table: PostAndUser;
};

// Virtual scrolling types
export type VirtualScrollParams = {
  offset?: number;
  limit?: number;
};

export type VirtualScrollResult<T> = {
  data: T[];
  hasMore: boolean;
  totalCount?: number;
};
