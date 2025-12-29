import React, { useMemo }  from "react";
import Lottie from "lottie-react";

import * as animationData from "./animation_data.json";
interface IAnimationProps {
  loop?: boolean;
  width?: number;
  height?: number;
}

const Animation = (props: IAnimationProps) => {
  // Clone the animation data to avoid "object is not extensible" error in Chrome extensions
  const clonedData = useMemo(() => JSON.parse(JSON.stringify(animationData)), []);

  return <div>
    <Lottie
      animationData={clonedData}
      style={{ width: props.width, height: props.height }}
      loop={props.loop}
    />
  </div>
}

export default Animation;
