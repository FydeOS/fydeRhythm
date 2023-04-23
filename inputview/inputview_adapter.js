// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
//

console.htmlLog = function (s) {
  const containerConsole = document.getElementById("console");
  const containerLog = document.createElement("div");
  const text = document.createTextNode(s);
  containerLog.appendChild(text);
  containerConsole.appendChild(containerLog);
}

console.htmlLog('>>>load inputview_adapter.js');
var CLOSURE_NO_DEPS=true;

var controller;

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

/**
 * Return the most recently used US layout. By default, this will return the
 * compact layout.
 */
function getDefaultUsLayout() {
  return window.localStorage['vkDefaultLayoutIsFull']
      ? 'us' : 'us.compact.qwerty';
}

// Plug in for API calls.
function registerInputviewApi() {

  // Flag values for ctrl, alt and shift as defined by EventFlags
  // in "event_constants.h".
  // @enum {number}
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

  /**
   * Displays a console message containing the last runtime error.
   * @private
   */
  function logIfError_() {
    if (chrome.runtime.lastError) {
      console.log(chrome.runtime.lastError);
    }
  }

  function commitText_(text) {
    chrome.virtualKeyboardPrivate.insertText(text);
  }

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

  /**
   * Dispatches a virtual key event. The system VK does not use the IME
   * API as its primary role is to work in conjunction with a non-VK aware
   * IME. Some reformatting of the key data is required to work with the
   * virtualKeyboardPrivate API.
   * @param {!Object} keyData Description of the key event.
   */
  function sendKeyEvent_(keyData) {
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

  function setState (state) {
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

  // core implement
  // connect to rime extention backgroundWindow
  var defaultSendMessage = chrome.runtime.sendMessage;
  registerFunction('chrome.runtime.sendMessage', function(message) {
    if (message.name == 'send_key_event') {
      sendKeyEvent_(message.keyData);
    } else if (message.name == 'commit_text') {
      commitText_(message.text);
    } else {
      defaultSendMessage(message);
    }
    return true;
  });
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
  console.htmlLog(">>>inputview_adapter onload");
  chrome.virtualKeyboardPrivate.setContainerBehavior({mode: "FULL_WIDTH", bounds: {left: 0, top: 0, width: window.screen.width, height: 0}}, function () {
    console.htmlLog(">>>chrome.virtualKeyboardPrivate.setContainerBehavior");
    var params = {};
    var matches = window.location.href.match(/[#?].*$/);
    if (matches && matches.length > 0) {
      matches[0].slice(1).split('&').forEach(function(s) {
        var pair = s.split('=');
        params[pair[0]] = pair[1];
      });
    }

    var keyset = "pinyin-zh-CN.compact.qwerty";
    var languageCode = 'zh-CN';
    var passwordLayout = 'pinyin-zh-CN.en.compact.qwerty';
    var name = params['inputmethod_pinyin'];

    
    window.resizeTo(window.screen.width, 372);
    window.moveTo(0, window.screen.height - 372);
    
      overrideSwitchToKeyset();
      overrideGetSpatialData();
      registerInputviewApi();
      i18n.input.chrome.inputview.Controller.DEV = true;
      i18n.input.chrome.inputview.Adapter.prototype.isSwitching = function() {
        return false;
      };

      if (keyset != 'none') {
        window.initializeVirtualKeyboard(keyset, languageCode, passwordLayout,
            name);
      }
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
  console.htmlLog(">>>initializeVirtualKeyboard");

  // override createWindow for workaround
  inputview.createWindow = function (url, options, callback) {
    console.htmlLog(">>>inputview.createWindow");
  }

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