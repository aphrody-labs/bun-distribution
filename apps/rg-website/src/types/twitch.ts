export interface TwitchStreamInfo {
  title: string;
  game_name: string;
  viewer_count: number;
  started_at: string;
  language: string;
  tags: string[];
}

export interface TwitchChannelInfo {
  description: string;
  broadcaster_language: string;
  totalViews: number;
  profileImageUrl: string;
  createdAt: string;
}

export interface TwitchVideo {
  id: string;
  title: string;
  thumbnail_url: string;
  view_count: number;
  created_at: string;
  duration: string;
  url: string;
}

export interface TwitchClip {
  id: string;
  title: string;
  thumbnail_url: string;
  view_count: number;
  created_at: string;
  creator_name: string;
  url: string;
}

export interface TwitchData {
  isLive: boolean;
  videoId: string | null;
  followers: number;
  streamInfo: TwitchStreamInfo | null;
  channelInfo?: TwitchChannelInfo | null;
  recentVideos?: TwitchVideo[];
  topClips?: TwitchClip[];
}
