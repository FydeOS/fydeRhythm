// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//

console.log('>>>load inputview_adapter.js');
var CLOSURE_NO_DEPS=true;

var controller;
const port = chrome.runtime.connect(null, {name: "inputviewMessages"});
var currentVirtualKeyboardConfigKey = '';

// --- Key event helpers ---
// Kept at top level so the chrome.runtime.sendMessage override below can
// reference them before registerInputviewApi() is called.

// Flag values for ctrl, alt and shift as defined by EventFlags
// in "event_constants.h".
var Modifier = {
  NONE: 0,
  ALT: 8,
  CONTROL: 4,
  SHIFT: 2,
  CAPSLOCK: 256
};

// Mapping from keyName to keyCode (see ui::KeyEvent).
var nonAlphaNumericKeycodes = {
  Backquote: 0xC0,
  Backslash: 0xDC,
  Backspace: 0x08,
  BracketLeft: 0xDB,
  BracketRight: 0xDD,
  Comma: 0xBC,
  Enter: 0x0D,
  Period: 0xBE,
  Quote: 0xBF,
  Semicolon: 0xBA,
  Slash: 0xBF,
  Space: 0x20,
  Tab: 0x09
};

function logIfError_() {
  if (chrome.runtime.lastError) {
    console.log(chrome.runtime.lastError);
  }
}

function commitText_(text) {
  chrome.virtualKeyboardPrivate.insertText(text);
}

function isCompactAltKeyEvent_(keyData) {
  return keyData.length == 2 &&
      keyData[0].type == 'keydown' &&
      keyData[1].type == 'keyup' &&
      keyData[0].key &&
      keyData[0].key == keyData[1].key &&
      typeof keyData[0].code == 'string' &&
      keyData[0].code.indexOf('compactkbd-k-') == 0 &&
      keyData[1].code == keyData[0].code;
}

/**
 * Computes keyCodes for use with ui::KeyEvent.
 * @param {string} keyChar Character being typed.
 * @param {string} keyName w3c name of the character.
 */
function getKeyCode_(keyChar, keyName) {
  var keyCode = nonAlphaNumericKeycodes[keyName];
  if (keyCode)
    return keyCode;

  var match = /Key([A-Z])/.exec(keyName);
  if (match)
    return match[1].charCodeAt(0);

  match = /Digit([0-9])/.exec(keyName);
  if (match)
    return match[1].charCodeAt(0);

  if (keyChar.length == 1) {
    if (keyChar >= 'a' && keyChar <= 'z')
      return keyChar.charCodeAt(0) - 32;
    if (keyChar >= 'A' && keyChar <= 'Z')
      return keyChar.charCodeAt(0);
    if (keyChar >= '0' && keyChar <= '9')
      return keyChar.charCodeAt(0);
  }
  return 0;
}

/**
 * Dispatches a virtual key event. The system VK does not use the IME
 * API as its primary role is to work in conjunction with a non-VK aware
 * IME. Some reformatting of the key data is required to work with the
 * virtualKeyboardPrivate API.
 * @param {!Object} keyData Description of the key event.
 */
function sendKeyEvent_(keyData) {
  if (isCompactAltKeyEvent_(keyData)) {
    commitText_(keyData[0].key);
    return;
  }
  keyData.forEach(function(data) {
    var charValue = data.key.length == 1 ? data.key.charCodeAt(0) : 0;
    var keyCode = data.keyCode ? data.keyCode :
        getKeyCode_(data.key, data.code);
    var event = {
      type: data.type,
      charValue: charValue,
      keyCode: keyCode,
      keyName: data.code,
      modifiers: Modifier.NONE
    };
    if (data.altKey)
      event.modifiers |= Modifier.ALT;
    if (data.ctrlKey)
      event.modifiers |= Modifier.CONTROL;
    if (data.shiftKey)
      event.modifiers |= Modifier.SHIFT;
    if (data.capsLock)
      event.modifiers |= Modifier.CAPSLOCK;

    chrome.virtualKeyboardPrivate.sendKeyEvent(event, logIfError_);
  });
}

// Override chrome.runtime.sendMessage immediately (before inputview.js prototype
// methods run) so all VK→background messages are intercepted and routed through
// the port rather than reaching the extension background's chrome.runtime.onMessage
// listeners (which expect the @webext-core/messaging wire format).
chrome.runtime.sendMessage = function(message) {
  if (message && message.name == 'send_key_event') {
    sendKeyEvent_(message.keyData);
  } else if (message && message.name == 'commit_text') {
    commitText_(message.text);
  } else {
    try {
      port.postMessage(message);
    } catch (e) {
      console.warn('inputview: port disconnected, dropping message', message && message.name);
    }
  }
  return true;
};

// Coordination between port init message and window.onload.
// Either can arrive first; maybeTriggerInit() starts the keyboard once both are ready.
var _pendingName = null;
var _pendingVk = null;

function maybeTriggerInit() {
  if (_pendingName === null || _pendingVk === null) return;
  var vk = _pendingVk;
  var name = _pendingName;
  _pendingVk = null;
  overrideSwitchToKeyset();
  overrideGetSpatialData();
  registerInputviewApi();
  i18n.input.chrome.inputview.Controller.DEV = true;
  i18n.input.chrome.inputview.Adapter.prototype.isSwitching = function() { return false; };
  switchVirtualKeyboard(vk, name);
}

port.onMessage.addListener(function(msg) {
  console.log("Got message from background: ", msg);
  if (msg.name == 'init') {
    _pendingVk = getVirtualKeyboardConfig(msg.msg && msg.msg.asciiMode);
    maybeTriggerInit();
    return;
  }
  if (msg.name == 'schema_switched') {
    var vk = getVirtualKeyboardConfig(msg.msg && msg.msg.asciiMode);
    if (_pendingName === null) {
      // window.onload hasn't run yet, so the one-time overrides in maybeTriggerInit
      // haven't been installed. Stash the config and let maybeTriggerInit do the
      // full setup once onload fires, instead of initializing the keyboard without
      // the API hooks (which switchVirtualKeyboard would then no-op past).
      _pendingVk = vk;
      return;
    }
    switchVirtualKeyboard(vk, _pendingName);
    return;
  }
  if (controller && controller.adapter_) {
    controller.adapter_.onMessage_(msg, null, null);
  }
});

/**
 * Armed callback to be triggered when a keyset changes.
 * @type {{string:target function:callback}}
 * @private
 */
var keysetChangeListener_;

/**
 * Registers a function, which may override a preexisting implementation.
 * @param {string} path Full path for the function name.
 * @param {function=} opt_fn Optional function definition. If not specified,
 *     the default implementation prettyprints the method call with arguments.
 * @return {function} Registered function, which may be a mock implementation.
 */
function registerFunction(path, opt_fn) {
  var parts = path.split('.');
  var base = window;
  var part = null;
  var fn = opt_fn;
  if (!fn) {
    fn = function() {
      var prettyprint = function(arg) {
        if (arg instanceof Array) {
          var terms = [];
          for (var i = 0; i < arg.length; i++) {
            terms.push(prettyprint(arg[i]));
          }
          return '[' + terms.join(', ') + ']';
        } else if (typeof arg == 'object') {
          var properties = [];
          for (var key in arg) {
             properties.push(key + ': ' + prettyprint(arg[key]));
          }
          return '{' + properties.join(', ') + '}';
        } else {
          return arg;
        }
      };
      // The property 'arguments' is an array-like object. Convert to a true
      // array for prettyprinting.
      var args = Array.prototype.slice.call(arguments);
      console.log('Call to ' + path + ': ' + prettyprint(args));
    };
  }
  for (var i = 0; i < parts.length - 1; i++) {
    part = parts[i];
    if (!base[part]) {
      base[part] = {};
    }
    base = base[part];
  }
  base[parts[parts.length - 1]] = fn;
  return fn;
}

/**
 * Overrides call to switch keysets in order to catch when the keyboard
 * is ready for input. Used to synchronize the start of automated
 * virtual keyboard tests.
 */
function overrideSwitchToKeyset() {
  var KeyboardContainer = i18n.input.chrome.inputview.KeyboardContainer;
  var switcher = KeyboardContainer.prototype.switchToKeyset;
  KeyboardContainer.prototype.switchToKeyset = function() {
    var success = switcher.apply(this, arguments);
    if (success) {
      // The first resize call forces resizing of the keyboard window.
      // The second resize call forces a clean layout for chrome://keyboard.
      controller.resize(false);
      controller.resize(true);

      chrome.virtualKeyboardPrivate.setHitTestBounds([{left: 0, top: 0, width: window.innerWidth, height: window.innerHeight}]);

      var settings = controller.model_.settings;
      settings.supportCompact = true;
      if (keysetChangeListener_ &&
          keysetChangeListener_.target == arguments[0]) {
        var callback = keysetChangeListener_.callback;
        keysetChangeListener_ = undefined;
        // TODO (rsadam): Get rid of this hack. Currently this is needed to
        // ensure the keyset was fully loaded before carrying on with the test.
        setTimeout(callback, 0);
      }
    }
    return success;
  };
}

/**
 * Arms a one time callback to invoke when the VK switches to the target keyset.
 * Only one keyset change callback may be armed at any time. Used to synchronize
 * tests and to track initial load time for the virtual keyboard.
 * @param {string} keyset The target keyset.
 * @param {function} callback The callback to invoke when the keyset becomes
 *     active.
 */
function onSwitchToKeyset(keyset, callback) {
  if (keysetChangeListener_) {
    console.error('A keyset change listener is already armed.');
    return;
  }
  keysetChangeListener_ = {
    target: keyset,
    callback: callback
  };
}

/**
 * Spatial data is used in conjunction with a language model to offer
 * corrections for 'fat finger' typing and is not needed for the system VK.
 */
function overrideGetSpatialData() {
  var Controller = i18n.input.chrome.inputview.Controller;
  Controller.prototype.getSpatialData_ = function() {};
}

function overrideAltDataView() {
  var AltDataView = i18n.input.chrome.inputview.elements.content.AltDataView;
  if (!AltDataView || AltDataView.prototype.fydeInlineAltData_) {
    return;
  }
  var show = AltDataView.prototype.show;
  var getHighlightedCharacter = AltDataView.prototype.getHighlightedCharacter;
  var highlightItem = AltDataView.prototype.highlightItem;
  AltDataView.prototype.show = function() {
    this.useIMEWindow_ = false;
    this.fydeSuppressInitialHighlight_ = true;
    try {
      show.apply(this, arguments);
    } finally {
      this.fydeSuppressInitialHighlight_ = false;
    }
    if (!this.visible_) {
      if (this.coverElement_) {
        goog.style.setElementShown(this.coverElement_, false);
      }
      if (this.triggeredBy) {
        this.triggeredBy.setHighlighted(false);
      }
      return;
    }

    var key = arguments[0];
    if (key && key.getElement) {
      var parentKeyLeftTop = goog.style.getClientPosition(key.getElement());
      var width = key.availableWidth || 0;
      var height = key.availableHeight || 0;
      var w = key.type == i18n.input.chrome.ElementType.COMPACT_KEY ?
          Math.round(width * 0.8) : Math.round(width * 0.9);
      var h = key.type == i18n.input.chrome.ElementType.COMPACT_KEY ?
          Math.round(height * 0.8) : Math.round(height * 0.9);
      highlightItem.call(this,
          Math.ceil(parentKeyLeftTop.x + w / 2),
          Math.ceil(parentKeyLeftTop.y + h / 2),
          arguments[2]);
    }
    if (!this.visible_ && this.coverElement_) {
      goog.style.setElementShown(this.coverElement_, false);
    }
  };
  AltDataView.prototype.highlightItem = function() {
    if (this.fydeSuppressInitialHighlight_) {
      return;
    }
    return highlightItem.apply(this, arguments);
  };
  AltDataView.prototype.getHighlightedCharacter = function() {
    if (this.useIMEWindow_) {
      return getHighlightedCharacter.apply(this, arguments);
    }
    if (this.highlightIndex_ < 0 || !this.altdataElements_[this.highlightIndex_]) {
      return '';
    }
    return getHighlightedCharacter.apply(this, arguments);
  };
  AltDataView.prototype.fydeInlineAltData_ = true;
}

/**
 * Return the most recently used US layout. By default, this will return the
 * compact layout.
 */
function getDefaultUsLayout() {
  return window.localStorage['vkDefaultLayoutIsFull']
      ? 'us' : 'us.compact.qwerty';
}

function getVirtualKeyboardConfig(asciiMode) {
  return {
    keyset: asciiMode ? 'pinyin-zh-CN.en.compact.qwerty' : 'pinyin-zh-CN.compact.qwerty',
    languageCode: 'zh-CN',
    passwordLayout: 'pinyin-zh-CN.en.compact.qwerty'
  };
}

function switchVirtualKeyboard(config, name) {
  var configKey = config.keyset + '|' + config.languageCode + '|' + config.passwordLayout;
  if (controller && currentVirtualKeyboardConfigKey == configKey) {
    return;
  }
  currentVirtualKeyboardConfigKey = configKey;
  window.initializeVirtualKeyboard(config.keyset, config.languageCode, config.passwordLayout, name);
}

// Plug in for API calls.
function registerInputviewApi() {

  /**
   * Retrieve the preferred keyboard configuration.
   * @param {function} callback The callback function for processing the
   *     keyboard configuration.
   * @private
   */
  function getKeyboardConfig_(callback) {
    chrome.virtualKeyboardPrivate.getKeyboardConfig(function (conf) {
      conf.a11ymode = false;
      conf.hotrodmode = false;

      if (!(window.innerHeight == 0 && window.innerWidth == window.screen.width)) {
        //conf.features.push("floatingvirtualkeyboard-enabled");
      }
      console.log(conf);
      callback(conf);
    });
  }

  /**
   * Retrieve a list of all enabled input methods.
   * @param {function} callback The callback function for processing the list
   *     of enabled input methods.
   * @private
   */
  function getInputMethods_(callback) {
    if (chrome.inputMethodPrivate)
      chrome.inputMethodPrivate.getInputMethods(callback);
    else
      callback([]);
  }

  /**
   * Retrieve the name of the active input method.
   * @param {function} callback The callback function for processing the
   *     name of the active input mehtod.
   * @private
   */
  function getCurrentInputMethod_(callback) {
    if (chrome.inputMethodPrivate) {
      chrome.inputMethodPrivate.getCurrentInputMethod(callback);
    } else {
      callback('');
    }
  }

  /**
   * Retrieve the current display size in inches.
   * @param {function} callback
   * @private
   */
  function getDisplayInInches_(callback) {
    callback(27);
  }

  /**
   * Retrieve the current input method configuration.
   * @param {function} callback The callback function for processing the
   *     name of the active input mehtod.
   * @private
   */
  function getInputMethodConfig_(callback) {
    if (chrome.inputMethodPrivate)
      chrome.inputMethodPrivate.getInputMethodConfig(callback);
    else
      callback('');
  }

  /**
   * Changes the active input method.
   * @param {string} inputMethodId The id of the input method to activate.
   * @private
   */
  function switchToInputMethod_(inputMethodId) {
    if (chrome.inputMethodPrivate) {
      chrome.inputMethodPrivate.setCurrentInputMethod(inputMethodId)
    }
  }

  /**
   * Opens the language settings for specifying and configuring input methods.
   * @private
   */
  function openSettings_() {
    chrome.virtualKeyboardPrivate.openSettings();
  }

  function setState (state) {
  }

  function setMode_(mode) {
    console.log(mode);
    return true;
  }

  window.inputview = {
    commitText: commitText_,
    getKeyboardConfig: getKeyboardConfig_,
    getInputMethods: getInputMethods_,
    getCurrentInputMethod: getCurrentInputMethod_,
    getInputMethodConfig: getInputMethodConfig_,
    switchToInputMethod: switchToInputMethod_,
    getDisplayInInches: getDisplayInInches_,
    openSettings: openSettings_,
    setMode: setMode_,
  };

  registerFunction('chrome.input.ime.hideInputView', function() {
    chrome.virtualKeyboardPrivate.hideKeyboard();
    chrome.virtualKeyboardPrivate.lockKeyboard(false);
  });

  // chrome.runtime.sendMessage is already overridden at the top of this file.
}

if (!chrome.i18n) {
  chrome.i18n = {};
  chrome.i18n.getMessage = function(name) {
    return name;
  }
}

/**
 * Trigger loading the virtual keyboard on completion of page load.
 */
window.onload = function() {
  console.log(">>>inputview_adapter onload");
  chrome.virtualKeyboardPrivate.setContainerBehavior({mode: "FULL_WIDTH", bounds: {left: 0, top: 0, width: window.screen.width, height: 0}}, function () {
    console.log(">>>chrome.virtualKeyboardPrivate.setContainerBehavior");
    var params = {};
    var matches = window.location.href.match(/[#?].*$/);
    if (matches && matches.length > 0) {
      matches[0].slice(1).split('&').forEach(function(s) {
        var pair = s.split('=');
        params[pair[0]] = pair[1];
      });
    }

    window.resizeTo(window.screen.width, 372);
    window.moveTo(0, window.screen.height - 372);

    _pendingName = params['inputmethod_pinyin'];
    maybeTriggerInit();
  });
};


/**
 * Run cleanup tasks.
 */
window.onbeforeunload = function() {
  if (controller)
    goog.dispose(controller);
};

/**
 * Loads a virtual keyboard. If a keyboard was previously loaded, it is
 * reinitialized with the new configuration.
 * @param {string} keyset The keyboard keyset.
 * @param {string} languageCode The language code for this keyboard.
 * @param {string} passwordLayout The layout for password box.
 * @param {string} name The input tool name.
 * @param {Object=} opt_config Optional configuration settings.
 */
window.initializeVirtualKeyboard = function(keyset, languageCode, passwordLayout, name, opt_config) {
  console.log(">>>initializeVirtualKeyboard");

  // override createWindow for workaround
  inputview.createWindow = function (url, options, callback) {
    console.log(">>>inputview.createWindow");
  }

  overrideAltDataView();

  var Controller = i18n.input.chrome.inputview.Controller;
  Controller.DISABLE_HWT = !(opt_config && opt_config.enableHwtForTesting);
  onSwitchToKeyset(keyset, function() {
    chrome.virtualKeyboardPrivate.keyboardLoaded();
  });

  // set candidatesNavigation as default
  i18n.input.chrome.inputview.Settings.prototype.candidatesNavigation = true;
  i18n.input.chrome.inputview.elements.content.CandidateView.prototype.navigation_ = true;

  if (controller) {
    controller.initialize(keyset, languageCode, passwordLayout, name);
  }
  else {
    controller = new Controller(keyset, languageCode, passwordLayout, name);
  }
};
