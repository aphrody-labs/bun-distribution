// SPDX-License-Identifier: Apache-2.0
// SRT (SubRip) transcript parsing shared by the video subtitles and the audio lyrics view.

export interface SubtitleCue {
  index: number;
  startTime: number;
  endTime: number;
  text: string;
}

/**
 * Parse SRT (SubRip) subtitle format
 * Format:
 * 1
 * 00:00:01,000 --> 00:00:04,000
 * Subtitle text here
 *
 * 2
 * 00:00:05,000 --> 00:00:08,000
 * Next subtitle
 */
export function parseSRT(srtContent: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = srtContent.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    const timecodeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);

    if (!timecodeMatch) continue;

    const startTime =
      parseInt(timecodeMatch[1]) * 3600 +
      parseInt(timecodeMatch[2]) * 60 +
      parseInt(timecodeMatch[3]) +
      parseInt(timecodeMatch[4]) / 1000;

    const endTime =
      parseInt(timecodeMatch[5]) * 3600 +
      parseInt(timecodeMatch[6]) * 60 +
      parseInt(timecodeMatch[7]) +
      parseInt(timecodeMatch[8]) / 1000;

    const text = lines.slice(2).join("\n");

    cues.push({ index, startTime, endTime, text });
  }

  return cues;
}
