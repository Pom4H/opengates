import React from "react";
import { Composition } from "remotion";
import { Flow } from "./Flow.tsx";
import { TOTAL_FRAMES } from "./theme.ts";
import {
  BuildingProgress,
  BUILDING_FPS,
  BUILDING_FRAMES,
} from "./building/BuildingProgress.tsx";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OpenGatesFlow"
        component={Flow}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="BuildingProgress"
        component={BuildingProgress}
        durationInFrames={BUILDING_FRAMES}
        fps={BUILDING_FPS}
        width={1280}
        height={720}
      />
    </>
  );
};
