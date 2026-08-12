/// <reference types="unplugin-icons/types/react" />

// Material Symbols via unplugin-icons — each import inlines an SVG component at
// build time (no runtime dep, CSP-safe). Re-exported under the previous names.

import Backspace from '~icons/material-symbols/backspace';
import BackspaceOutline from '~icons/material-symbols/backspace-outline';
import ChevronLeft from '~icons/material-symbols/chevron-left';
import ChevronRight from '~icons/material-symbols/chevron-right';
import Close from '~icons/material-symbols/close';
import ContentPaste from '~icons/material-symbols/content-paste';
import ContentPasteOff from '~icons/material-symbols/content-paste-off';
import DeleteOutline from '~icons/material-symbols/delete-outline';
import ErrorOutline from '~icons/material-symbols/error-outline';
import ExpandLess from '~icons/material-symbols/expand-less';
import ExpandMore from '~icons/material-symbols/expand-more';
import KeyboardHide from '~icons/material-symbols/keyboard-hide-outline';
import KeyboardOutline from '~icons/material-symbols/keyboard-outline';
import KeyboardReturn from '~icons/material-symbols/keyboard-return';
import Language from '~icons/material-symbols/language';
import Mic from '~icons/material-symbols/mic-outline';
import Mood from '~icons/material-symbols/mood-outline';
import OpenInFull from '~icons/material-symbols/open-in-full';
import Refresh from '~icons/material-symbols/refresh';
import Resize from '~icons/material-symbols/resize-window-rounded';
import Schedule from '~icons/material-symbols/schedule-outline';
import Settings from '~icons/material-symbols/settings-outline';
import Shift from '~icons/material-symbols/shift';
import ShiftLock from '~icons/material-symbols/shift-lock';
import ShiftOutline from '~icons/material-symbols/shift-outline';
import StopCircle from '~icons/material-symbols/stop-circle-outline';

export const SettingsIcon = Settings;
export const MoodIcon = Mood;
export const MicIcon = Mic;
export const StopIcon = StopCircle;
export const KeyboardHideIcon = KeyboardHide;
// Names the destination — not keyboard-hide, whose down-arrow means the opposite.
export const KeyboardIcon = KeyboardOutline;
export const ChevronLeftIcon = ChevronLeft;
export const ChevronRightIcon = ChevronRight;
export const ExpandMoreIcon = ExpandMore;
export const ExpandLessIcon = ExpandLess;
export const ScheduleIcon = Schedule;
export const BackspaceIcon = Backspace;
export const BackspaceOutlineIcon = BackspaceOutline;
export const EnterIcon = KeyboardReturn;
// Shift off → outline; shift engaged → filled; caps lock → the locked shift.
export const ShiftIcon = ShiftOutline;
export const ShiftFilledIcon = Shift;
export const CapsLockIcon = ShiftLock;
export const LanguageIcon = Language;
export const ResizeGripIcon = Resize;
export const ExpandKeyboardIcon = OpenInFull;
export const ClipboardIcon = ContentPaste;
export const ClipboardOffIcon = ContentPasteOff;
export const ErrorIcon = ErrorOutline;
export const RefreshIcon = Refresh;
export const CloseIcon = Close;
export const DeleteIcon = DeleteOutline;
