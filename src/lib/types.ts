export interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
  created_at: string;
  referral_code?: string | null;
  last_seen_at?: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  kind: string;
  read: boolean;
  created_at: string;
}

export type ConversationType = "dm" | "group" | "channel";

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  avatar_url: string | null;
  created_by: string;
  last_message_at: string | null;
  last_message_body: string | null;
  pinned_body: string | null;
  pinned_at: string | null;
  conversation_members: ConversationMember[];
}

export interface ConversationMember {
  user_id: string;
  last_read_at: string | null;
  muted: boolean;
  profiles: Profile;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  kind: "text" | "image" | "file" | "voice" | "sticker" | "gif";
  media_url: string | null;
  file_name: string | null;
  duration_seconds: number | null;
  one_view: boolean;
  deleted_for_everyone: boolean;
  created_at: string;
  profiles: Profile;
  message_deletes: { user_id: string }[];
  message_views: { user_id: string }[];
  message_deliveries: { user_id: string }[];
}

export interface PaymentRequest {
  id: string;
  user_id: string;
  screenshot_path: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface PostMedia {
  id: string;
  post_id: string;
  url: string;
  position: number;
}

export interface Post {
  id: string;
  author_id: string;
  caption: string;
  created_at: string;
  profiles: Profile;
  post_media: PostMedia[];
  post_likes: { user_id: string }[];
  post_bookmarks: { user_id: string }[];
  comments: { count: number }[];
}

export interface Comment {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles: Profile;
}

export interface Story {
  id: string;
  author_id: string;
  media_url: string;
  caption: string | null;
  created_at: string;
  expires_at: string;
  profiles: Profile;
}

export interface Reel {
  id: string;
  author_id: string;
  video_url: string;
  caption: string;
  music_title: string | null;
  created_at: string;
  profiles: Profile;
  reel_likes: { user_id: string }[];
  reel_comments: { count: number }[];
}

export interface ReelComment {
  id: string;
  reel_id: string;
  author_id: string;
  body: string;
  created_at: string;
  profiles: Profile;
}

export interface CallLog {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  kind: "voice" | "video";
  status: "ringing" | "answered" | "missed" | "declined" | "cancelled";
  duration_seconds: number;
  created_at: string;
  updated_at: string;
  caller: Profile;
  callee: Profile;
}

export interface Video {
  id: string;
  channel_id: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  views: number;
  created_at: string;
  profiles: Profile;
  video_likes: { user_id: string; value: number }[];
  video_bookmarks: { user_id: string }[];
}
