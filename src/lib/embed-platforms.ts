// Config-driven allowlist of video/audio platforms that a bare link (on its
// own paragraph) auto-embeds into. Deliberately NOT a generic "allow raw
// <iframe> HTML" feature — rehype-sanitize never allowlists iframe, so any
// hand-typed <iframe> in markdown is always stripped. Only a URL matching one
// of these regexes gets an iframe built from OUR OWN embedUrl(), sourced
// entirely from a hardcoded domain + a regex-captured id. The author's input
// never reaches the iframe `src` directly — that's the security boundary.

export type EmbedKind = "video" | "audio";

export interface EmbedPlatformConfig {
  name: string;
  kind: EmbedKind;
  title: string;
  match: RegExp;
  embedUrl: (match: RegExpExecArray) => string;
  /** Video embeds size via aspect-ratio (responsive width). */
  aspectRatio?: string;
  /** Audio embeds use a fixed height per the platform's own embed recommendation. */
  height?: number;
}

export const EMBED_PLATFORMS: EmbedPlatformConfig[] = [
  {
    name: "youtube",
    kind: "video",
    title: "YouTube video player",
    match: /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})(?:[?&][^\s]*)?$/i,
    embedUrl: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}`,
    aspectRatio: "16 / 9",
  },
  {
    name: "spotify-episode",
    kind: "audio",
    title: "Spotify episode player",
    match: /^https?:\/\/open\.spotify\.com\/episode\/([a-zA-Z0-9]+)(?:\?[^\s]*)?$/i,
    embedUrl: (m) => `https://open.spotify.com/embed/episode/${m[1]}`,
    height: 232,
  },
  {
    name: "apple-podcasts",
    kind: "audio",
    title: "Apple Podcasts episode player",
    // Apple's own embed convention: prefix the hostname with "embed.", keep path+query as-is.
    match: /^https?:\/\/podcasts\.apple\.com\/([^\s]+)$/i,
    embedUrl: (m) => `https://embed.podcasts.apple.com/${m[1]}`,
    height: 175,
  },
];

export interface MatchedEmbed {
  config: EmbedPlatformConfig;
  embedSrc: string;
}

export function matchEmbedPlatform(url: string): MatchedEmbed | null {
  const trimmed = url.trim();
  for (const config of EMBED_PLATFORMS) {
    const match = config.match.exec(trimmed);
    if (match) return { config, embedSrc: config.embedUrl(match) };
  }
  return null;
}
