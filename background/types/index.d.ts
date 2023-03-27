export {};
import type { InputController } from "~background";
import type { RimeEngine } from "~background/engine";

declare global {
  interface Window {
    currentEngine: RimeEngine;
    controller: InputController;
  }
}