// Shared palette and timing for the Open Gates flow animation.

export const COLORS = {
  bg: "#070b12",
  bgPanel: "#0e1622",
  bgCard: "#111c2b",
  border: "#1e2d40",
  borderActive: "#2f4a6b",
  text: "#e6edf6",
  textDim: "#7e8ea3",
  textFaint: "#4a5b6e",
  accent: "#4ade80", // accepted / pass
  accentSoft: "rgba(74,222,128,0.14)",
  money: "#fbbf24",
  proceed: "#60a5fa",
  risk: "#f472b6",
  label: "#a78bfa",
  track: "#1a2636",
} as const;

export const FONT =
  '"SF Mono", "JetBrains Mono", "Fira Code", ui-monospace, Menlo, monospace';
export const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif';

// Each stage owns a window of frames on a 30fps timeline.
export const STAGE_FRAMES = 78;
export const INTRO_FRAMES = 36;
export const OUTRO_FRAMES = 66;
export const STAGES = 5;
export const TOTAL_FRAMES =
  INTRO_FRAMES + STAGES * STAGE_FRAMES + OUTRO_FRAMES;
