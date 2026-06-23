// The construction work-volume-acceptance gate, expressed as the five steps
// the animation walks through. Numbers mirror examples/construction.

import { COLORS } from "./theme.ts";

export type Step = {
  key: string;
  index: number; // 1..5
  label: string;
  glyph: string;
  color: string;
  title: string;
  lines: string[];
};

export const STEPS: Step[] = [
  {
    key: "claim",
    index: 1,
    label: "CLAIM",
    glyph: "✎",
    color: COLORS.text,
    title: "A fact is asserted",
    lines: [
      "contractor:alfa-stroy claims",
      "Foundation concrete C25/30",
      "120 m³  ·  period 2026-05",
    ],
  },
  {
    key: "evidence",
    index: 2,
    label: "EVIDENCE",
    glyph: "▤",
    color: COLORS.proceed,
    title: "It is proved",
    lines: [
      "surveyor:geo-point attaches",
      "independent survey → 117 m³",
      "+ delivery notes",
    ],
  },
  {
    key: "checks",
    index: 3,
    label: "CHECKS",
    glyph: "✓",
    color: COLORS.accent,
    title: "The system verifies it",
    lines: [
      "evidence present        ✓",
      "quantity positive       ✓",
      "120 vs 117 = 2.5% ≤ 5%  ✓",
    ],
  },
  {
    key: "decision",
    index: 4,
    label: "DECISION",
    glyph: "⊙",
    color: COLORS.accent,
    title: "A role accepts it",
    lines: [
      "reviewer: technical_supervisor",
      "supervisor:ivanov → ACCEPTED",
      "responsibility is now owned",
    ],
  },
  {
    key: "consequence",
    index: 5,
    label: "CONSEQUENCE",
    glyph: "★",
    color: COLORS.money,
    title: "Money, rights & data appear",
    lines: [
      "💶  €10,200 earned value  (120 × 85)",
      "🔓  right to proceed → closeout",
      "🏷️  labelled: construction.work_acceptance",
    ],
  },
];
