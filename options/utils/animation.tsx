import React  from "react";
import Lottie from "lottie-react";

import * as animationData from "./animation_data.json";
interface IAnimationProps {
  loop?: boolean;
  width?: number;
  height?: number;
}

const Animation = (props: IAnimationProps) => {
  return <div>
    <Lottie
      animationData={animationData}
      style={{ width: props.width, height: props.height }}
      loop={props.loop}
    />
  </div>
}

export default Animation;
