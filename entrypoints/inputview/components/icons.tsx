/// <reference types="unplugin-icons/types/react" />

// Material Symbols via unplugin-icons — each import inlines an SVG component at
// build time (no runtime dep, CSP-safe). Re-exported under the previous names.

import Settings from '~icons/material-symbols/settings-outline';
import Mood from '~icons/material-symbols/mood-outline';
import KeyboardHide from '~icons/material-symbols/keyboard-hide-outline';
import ChevronLeft from '~icons/material-symbols/chevron-left';
import ChevronRight from '~icons/material-symbols/chevron-right';
import ExpandMore from '~icons/material-symbols/expand-more';
import ExpandLess from '~icons/material-symbols/expand-less';
import Schedule from '~icons/material-symbols/schedule-outline';
import Backspace from '~icons/material-symbols/backspace';
import KeyboardReturn from '~icons/material-symbols/keyboard-return';
import Shift from '~icons/material-symbols/shift';
import ShiftOutline from '~icons/material-symbols/shift-outline';
import ShiftLock from '~icons/material-symbols/shift-lock';
import Language from '~icons/material-symbols/language';
import Resize from '~icons/material-symbols/resize-window-rounded';

export const SettingsIcon = Settings;
export const MoodIcon = Mood;
export const KeyboardHideIcon = KeyboardHide;
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRightIcon = ChevronRight;
export const ExpandMoreIcon = ExpandMore;
export const ExpandLessIcon = ExpandLess;
export const ScheduleIcon = Schedule;
export const BackspaceIcon = Backspace;
export const EnterIcon = KeyboardReturn;
// Shift off → outline; shift engaged → filled; caps lock → the locked shift.
export const ShiftIcon = ShiftOutline;
export const ShiftFilledIcon = Shift;
export const CapsLockIcon = ShiftLock;
export const LanguageIcon = Language;
export const ResizeGripIcon = Resize;
