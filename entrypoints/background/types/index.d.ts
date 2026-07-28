export {};
import type { InputController } from '../controller';
import type { RimeEngine } from '../engine';

declare global {
  interface Window {
    currentEngine: RimeEngine;
    controller: InputController;
  }
}
