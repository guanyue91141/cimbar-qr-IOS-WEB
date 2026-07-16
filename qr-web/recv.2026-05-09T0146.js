// Console log capture for on-screen debug panel (mobile no-F12)
var _logBuffer = [];
var _maxLogLines = 200;
(function() {
  var origLog = console.log;
  var origWarn = console.warn;
  var origError = console.error;
  console.log = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    _logBuffer.push({ text: msg, type: 'log' });
    if (_logBuffer.length > _maxLogLines) _logBuffer.shift();
    origLog.apply(console, arguments);
  };
  console.warn = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    _logBuffer.push({ text: msg, type: 'warn' });
    if (_logBuffer.length > _maxLogLines) _logBuffer.shift();
    origWarn.apply(console, arguments);
  };
  console.error = function() {
    var msg = Array.prototype.slice.call(arguments).join(' ');
    _logBuffer.push({ text: msg, type: 'error' });
    if (_logBuffer.length > _maxLogLines) _logBuffer.shift();
    origError.apply(console, arguments);
  };
})();

// getUserMedia polyfill for older browsers (including some iOS versions)
if (navigator.mediaDevices === undefined) {
  navigator.mediaDevices = {};
}
if (navigator.mediaDevices.getUserMedia === undefined) {
  navigator.mediaDevices.getUserMedia = function(constraints) {
    var getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (!getUserMedia) {
      return Promise.reject(new Error('getUserMedia is not implemented in this browser'));
    }
    return new Promise(function(resolve, reject) {
      getUserMedia.call(navigator, constraints, resolve, reject);
    });
  };
}

var Sink = function () {

  var _fountainBuff = undefined;
  var _errBuff = undefined;
  var _errBuffSize = 1024;

  function fountain_buff() {
    if (_fountainBuff.buffer !== Module.HEAPU8.buffer) {
      _fountainBuff = new Uint8Array(Module.HEAPU8.buffer, _fountainBuff.byteOffset, _fountainBuff.byteLength);
    }
    return _fountainBuff;
  }

  // public interface
  return {
    allocate: function () {
      const size = Module._cimbard_get_bufsize(); // max length of buff. We could also resize as we go...
      if (_fountainBuff && size > _fountainBuff.length) {
        Module._free(_fountainBuff.byteOffset);
        _fountainBuff = undefined;
      }
      if (_fountainBuff === undefined) {
        const dataPtr = Module._malloc(size);
        _fountainBuff = new Uint8Array(Module.HEAPU8.buffer, dataPtr, size);
      }
    },

    on_decode: function (buff) {
      if (buff.length == 0) { // sanity check
        return;
      }
      const fountBuff = fountain_buff();
      fountBuff.set(buff);

      console.log('sink decode bytes ' + buff.length);
      var res = Module._cimbard_fountain_decode(fountBuff.byteOffset, buff.length);
      console.log("on decode got res " + res);

      const report = Sink.get_report();
      if (Array.isArray(report)) {
        Recv.render_progress(report);
      }
      else {
        Recv.set_HTML("tdec", "decode " + res + ". " + report);
      }

      if (res > 0) {
        const res32t = Number(res & 0xFFFFFFFFn);; // truncate BigInt res (int64_t) to a uint32_t
        Sink.reassemble_file(res32t);
      }
    },

    get_report: function () {
      if (_errBuff === undefined) {
        _errBuff = Module._malloc(_errBuffSize);
      }
      const errlen = Module._cimbard_get_report(_errBuff, _errBuffSize);
      if (errlen > 0) {
        const errview = new Uint8Array(Module.HEAPU8.buffer, _errBuff, errlen);
        const td = new TextDecoder();
        const text = td.decode(errview);
        try {
          return JSON.parse(text);
        } catch (error) {
          return text;
        }
      }
    },

    reassemble_file: function (id) {
      const size = Module._cimbard_get_filesize(id);
      //alert("we did it!?! " + size);
      try {
        var name = id + "." + size;
        const fnsize = Module._cimbard_get_filename(id, _errBuff, _errBuffSize);
        if (fnsize < 0) {
          alert("reassemble_file failed :(" + res);
          console.log("we biffed it. :( " + res);
          Recv.set_HTML("errorbox", "reassemble_file failed :( " + res);
        }
        else if (fnsize > 0) {
          const temparr = new Uint8Array(Module.HEAPU8.buffer, _errBuff, fnsize);
          name = new TextDecoder("utf-8").decode(temparr);
        }
        Zstd.decompress(name, id);
      } catch (error) {
        console.log("failed finish copy or download?? " + error);
      }
    }
  };
}();


var Recv = function () {

  var _counter = 0;
  var _recentDecode = -1;
  var _recentExtract = -1;
  var _renderTime = 0;
  var _captureNextFrame = 0;

  var _watchmanEnabled = 0;
  var _watchmanLastSeen = 1; // start at 1, can't restart if we never started

  var _video = 0;
  var _workers = [];
  var _nextWorker = 0;
  var _workerReady;
  var _workersReadyCount = 0;
  var _captureCanvas = null;
  var _captureCtx = null;
  var _cams = [];
  var _camResolutions = {};
  var _currentCamIndex = 0;
  var _framesInFlight = 0;
  var _supportedFormats = ["NV12", "I420"]; // have cimbard_* return this somehow?

  var _mode = 0;

  function _toggleFullscreen() {
    if (document.fullscreenElement) {
      return document.exitFullscreen();
    }
    else {
      return document.documentElement.requestFullscreen();
    }
  }

  function isIOS() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAppleDevice = navigator.userAgent.includes('Macintosh');
    const isTouchScreen = navigator.maxTouchPoints >= 1;
    return isIOS || (isAppleDevice && isTouchScreen);
  }

  function _getModeAspectRatio(mode) {
    // (image_size_x + 16) / (image_size_y + 16)
    switch (mode) {
      case 66: return 1.1516; // Bu
      case 67: return 1.413;  // Bm
      default: return 1.0;    // B, 4C, auto
    }
  }

  function _isRearCamera(cam, index) {
    var label = ((cam && cam.label) || '').toLowerCase();
    if (label.indexOf('后置') !== -1 || label.indexOf('rear') !== -1 || label.indexOf('back') !== -1 || label.indexOf('environment') !== -1) {
      return true;
    }
    if (label.indexOf('前置') !== -1 || label.indexOf('front') !== -1 || label.indexOf('user') !== -1) {
      return false;
    }
    // iPhone commonly enumerates the front camera before rear cameras.
    return index % 2 === 1;
  }

  function _cameraFacingLabel(cam, index) {
    return _isRearCamera(cam, index) ? 'rear' : 'front';
  }

  function _cameraPreferenceScore(cam, index) {
    var label = ((cam && cam.label) || '').toLowerCase();
    if (!_isRearCamera(cam, index)) {
      return 1000 + index;
    }

    // Prefer the plain rear/main camera over ultra-wide or telephoto lenses.
    var score = 100 + index;
    if (label === '后置相机' || label.indexOf('rear camera') !== -1 || label.indexOf('back camera') !== -1) {
      score = 0;
    } else if (label.indexOf('后置') !== -1 && label.indexOf('相机') !== -1 &&
      label.indexOf('超广角') === -1 && label.indexOf('广角') === -1 && label.indexOf('长焦') === -1) {
      score = 5;
    } else if (label.indexOf('三镜头') !== -1 || label.indexOf('triple') !== -1) {
      score = 20;
    } else if (label.indexOf('双镜头') !== -1 || label.indexOf('dual') !== -1) {
      score = 30;
    } else if (label.indexOf('超广角') !== -1 || label.indexOf('ultra') !== -1) {
      score = 70;
    } else if (label.indexOf('长焦') !== -1 || label.indexOf('tele') !== -1) {
      score = 80;
    } else if (label.indexOf('广角') !== -1 || label.indexOf('wide') !== -1) {
      score = 60;
    }
    return score + index / 100;
  }

  function _cameraQualityConstraints(extraVideoConstraints) {
    var videoConstraints = {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 15, max: 30 },
      focusMode: { ideal: 'continuous' },
      exposureMode: { ideal: 'continuous' }
    };
    for (var key in extraVideoConstraints) {
      videoConstraints[key] = extraVideoConstraints[key];
    }
    return {
      audio: false,
      video: videoConstraints
    };
  }

  function _formatResolution(width, height) {
    if (!width || !height) {
      return '';
    }
    return Math.round(width) + 'x' + Math.round(height);
  }

  function _cameraResolutionFromCapabilities(cam) {
    if (!cam || !cam.getCapabilities) {
      return '';
    }
    try {
      var caps = cam.getCapabilities();
      if (caps && caps.width && caps.height) {
        var maxRes = _formatResolution(caps.width.max, caps.height.max);
        var minRes = _formatResolution(caps.width.min, caps.height.min);
        if (maxRes && minRes && maxRes !== minRes) {
          return minRes + '-' + maxRes;
        }
        return maxRes || minRes;
      }
    } catch (e) {
      console.warn('[CameraDiag] Failed to read camera capabilities:', e && e.message ? e.message : e);
    }
    return '';
  }

  function _rememberCameraResolution(camIndex, stream) {
    if (!stream) {
      return;
    }
    var tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
    if (!tracks || tracks.length == 0) {
      return;
    }
    var settings = tracks[0].getSettings ? tracks[0].getSettings() : {};
    var resolution = _formatResolution(settings.width, settings.height);
    if (!resolution) {
      return;
    }
    _camResolutions[camIndex] = resolution;
    if (_cams[camIndex] && _cams[camIndex].deviceId) {
      _camResolutions[_cams[camIndex].deviceId] = resolution;
    }
    if (settings.deviceId) {
      _camResolutions[settings.deviceId] = resolution;
    }
    Recv.updateCameraListUI();
  }

  function _updateCrosshairPositions() {
    if (!_video || !_video.videoWidth || !_video.videoHeight)
      return;

    var modeAspect = _getModeAspectRatio(_mode);
    var container = document.getElementById('container');
    if (!container) return;
    var contW = container.clientWidth;
    var contH = container.clientHeight;
    var camAspect = _video.videoWidth / _video.videoHeight;
    var contAspect = contW / contH;

    var vidW = contW;
    var vidH = contH;
    if (camAspect > contAspect)  // black bars top/bottom
      vidH = vidW / camAspect;
    else  // black bars left/right
      vidW = vidH * camAspect;

    var offsetY;
    var offsetX;
    if (contH > contW) {
      // portrait
      offsetY = (contH - (vidW * modeAspect)) / 2;
      offsetX = (contW - vidW) / 2;
    }
    else {
      offsetY = (contH - vidH) / 2;
      offsetX = (contW - (vidH * modeAspect)) / 2;
    }

    var xh1 = document.getElementById("crosshair1");
    var xh2 = document.getElementById("crosshair2");
    xh1.style.top = offsetY + "px";
    xh1.style.right = offsetX + "px";
    xh2.style.bottom = offsetY + "px";
    xh2.style.left = offsetX + "px";
  }

  // public interface
  return {
    init: function (video, num_workers) {
      Recv.init_ww(num_workers);
      Recv.init_video(video);
    },

    set_error: function (msg) {
      Recv.set_HTML('errorbox', msg);
      return false;
    },

    ww_ready: new Promise(resolve => {
      _workerReady = resolve;
    }),

    frames_in_flight_incr: function () {
      _framesInFlight += 1;
      document.getElementById('framesInFlight').innerHTML = _framesInFlight;
    },

    frames_in_flight_decr: function () {
      _framesInFlight -= 1;
      document.getElementById('framesInFlight').innerHTML = _framesInFlight;
    },

    init_ww: function (num_workers) {
      // clean up _workers if exists?
      _workers = [];
      for (let i = 0; i < num_workers; i++) {
        _workers.push(new Worker('recv-worker.2026-05-09T0146.js'));

        _workers[i].onmessage = (event) => {
          Recv.on_decode(i, event.data);
        };

        _workers[i].onerror = (error) => {
          console.error('Worker' + i + ' error:', error);
        };
      }
    },

    _stopCamera: function () {
      if (_video && _video.srcObject) {
        var tracks = _video.srcObject.getTracks();
        tracks.forEach(function (track) { track.stop(); });
        _video.srcObject = null;
      }
    },

    _tryCamera: function (index) {
      if (index >= _cams.length) {
        Recv.set_error("All cameras failed to start.");
        return;
      }
      var cam = _cams[index];
      console.log('Trying camera ' + index + ': ' + (cam.label || '(no label)') + ' (deviceId: ' + cam.deviceId.substring(0, 8) + '...)');

      // iOS has strict constraint handling; avoid 'exact' deviceId on iOS
      var constraints;
      if (isIOS()) {
        // On iOS, camera labels are localized (e.g. '后置摄像头' in Chinese, 'Rückkamera' in German)
        // so label matching is best-effort. If labels are unavailable, we fall back to
        // the common iPhone order where front appears before rear.
        constraints = _cameraQualityConstraints({
          facingMode: _isRearCamera(cam, index) ? 'environment' : 'user'
        });
      } else {
        constraints = _cameraQualityConstraints({
          deviceId: { exact: cam.deviceId },
          facingMode: { ideal: 'environment' }
        });
      }
      Recv._startCamera(constraints, index);
    },

    _startCamera: function (constraints, camIndex) {
      var video = _video;
      // Store AbortError retry count per camera attempt
      if (this._abortRetry === undefined) this._abortRetry = {};
      var abortKey = 'cam_' + camIndex;
      if (this._abortRetry[abortKey] === undefined) this._abortRetry[abortKey] = 0;

      var timeoutMs = isIOS() ? 10000 : 15000; // iOS can be slower to show permission prompt
      var cameraStarted = false;

      var timeoutId = setTimeout(function() {
        if (!cameraStarted) {
          console.warn('[CameraDiag] Camera start timed out after ' + timeoutMs + 'ms (iOS Chrome/WKWebView known issue)');
          Recv.set_error('Camera timed out. On iOS Chrome, please ensure you are on iOS 14.3+ and try using Safari if the issue persists.');
        }
      }, timeoutMs);

      // iOS hack: temporarily add controls attribute — known workaround for iOS
      // where video element sometimes doesn't initialize the playback pipeline
      if (isIOS() && !video.hasAttribute('controls')) {
        video.setAttribute('controls', 'true');
        setTimeout(function() { video.removeAttribute('controls'); }, 100);
      }

      navigator.mediaDevices.getUserMedia(constraints)
        .then(function(localMediaStream) {
          clearTimeout(timeoutId);
          cameraStarted = true;
          // IMPORTANT: Set autoplay/playsinline DYNAMICALLY after getUserMedia succeeds.
          // Having autoplay in the HTML <video> tag can prevent Chrome on iOS from
          // showing the permission prompt (Chrome autoplay policy conflict).
          video.setAttribute('autoplay', '');
          video.setAttribute('playsinline', '');
          video.muted = true;
          if ('srcObject' in video) {
            video.srcObject = localMediaStream;
          } else {
            video.src = URL.createObjectURL(localMediaStream);
          }
          video.play();
          _rememberCameraResolution(camIndex, localMediaStream);
          video.onloadedmetadata = function () {
            _rememberCameraResolution(camIndex, localMediaStream);
          };
          video.requestVideoFrameCallback(Recv.on_frame);
          console.log('[CameraDiag] Camera ' + camIndex + ' started successfully');
          // Re-enumerate now that permission is granted (iOS hides labels before permission)
          // This populates the camera list and updates the UI selector.
          Recv.refreshCameraList();
        })
        .catch(function(err) {
          clearTimeout(timeoutId);
          console.error('[CameraDiag] Camera error with', JSON.stringify(constraints), err.name, err.message);

          // iOS 16.4+ AbortError bug: retry once
          if (err.name == 'AbortError' && this._abortRetry[abortKey] < 1) {
            this._abortRetry[abortKey] += 1;
            console.log('[CameraDiag] AbortError on iOS, retrying once...');
            setTimeout(function() {
              Recv._startCamera(constraints, camIndex);
            }, 500);
            return;
          }

          if ((err.name == 'NotReadableError' || err.name == 'NotFoundError') && _currentCamIndex + 1 < _cams.length) {
            _currentCamIndex += 1;
            console.log('[CameraDiag] Camera ' + camIndex + ' failed, trying camera ' + _currentCamIndex);
            Recv._tryCamera(_currentCamIndex);
            return;
          }
          if (err.name == 'NotReadableError') {
            Recv.set_error("Camera is busy. Please close other apps using the camera (Zoom, Teams, Camera app) and refresh.");
          } else if (err.name == 'NotFoundError') {
            Recv.set_error("No camera found. Please connect a camera and refresh.");
          } else if (err.name == 'NotAllowedError') {
            var msg = "Camera permission denied. Please allow camera access and refresh.";
            if (isIOS()) {
              msg += " Note: iOS Chrome uses Safari's engine. If still failing, try opening this page in Safari directly, or check iOS Settings > Safari > Camera.";
            }
            Recv.set_error(msg);
          } else if (err.name == 'OverconstrainedError') {
            // constraints too strict, try simpler
            console.log('[CameraDiag] OverconstrainedError, falling back to basic video constraint');
            Recv._startCamera({ audio: false, video: true }, camIndex);
          } else if (err.name == 'TypeError' || err.message && err.message.indexOf('undefined') !== -1) {
            Recv.set_error("Camera API not available. On iOS, this requires iOS 14.3 or later. Please use Safari or update your iOS version.");
          } else {
            Recv.set_error("Camera error: " + err.message);
          }
        });
    },

    switchCamera: function () {
      if (_cams.length < 2) {
        console.log('Only one camera available');
        return;
      }
      // Stop current stream
      Recv._stopCamera();
      // Cycle to next camera
      _currentCamIndex = (_currentCamIndex + 1) % _cams.length;
      console.log('Switching to camera ' + _currentCamIndex + ': ' + (_cams[_currentCamIndex].label || '(no label)'));
      Recv._tryCamera(_currentCamIndex);
    },

    // Toggle the camera list dropdown open/closed
    toggleCameraList: function () {
      var panel = document.getElementById('cam-list-panel');
      var arrow = document.getElementById('cam-arrow');
      if (!panel) return;
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        if (arrow) arrow.classList.remove('open');
      } else {
        Recv.refreshCameraList();
        panel.classList.add('open');
        if (arrow) arrow.classList.add('open');
      }
    },

    // Close the camera list dropdown
    closeCameraList: function () {
      var panel = document.getElementById('cam-list-panel');
      var arrow = document.getElementById('cam-arrow');
      if (panel) panel.classList.remove('open');
      if (arrow) arrow.classList.remove('open');
    },

    // Enumerate all video devices and update the camera list UI
    refreshCameraList: function () {
      var refreshBtn = document.getElementById('cam-refresh-btn');
      if (refreshBtn) refreshBtn.classList.add('loading');

      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var allCams = devices.filter(function(d) { return d.kind == 'videoinput'; });
        if (allCams.length > 0) {
          var oldLen = _cams.length;
          _cams = allCams;
          if (allCams.length !== oldLen) {
            console.log('[CameraDiag] Camera list updated: ' + allCams.length + ' cameras');
            allCams.forEach(function(cam, i) {
              console.log('  ' + i + ': ' + (cam.label || '(no label)'));
            });
          }
        }
        Recv.updateCameraListUI();
      }).catch(function(err) {
        console.error('enumerateDevices error:', err);
      }).then(function() {
        if (refreshBtn) refreshBtn.classList.remove('loading');
      });
    },

    // Update the camera selector UI to reflect _cams and _currentCamIndex
    updateCameraListUI: function () {
      var itemsEl = document.getElementById('cam-list-items');
      var labelEl = document.getElementById('cam-current-label');
      if (!itemsEl) return;

      var html = '';
      for (var ci = 0; ci < _cams.length; ci++) {
        var cam = _cams[ci];
        var camName = cam.label || ('Camera ' + (ci + 1));
        var checked = ci === _currentCamIndex ? ' active' : '';
        var resolution = _camResolutions[cam.deviceId] || _camResolutions[ci] || _cameraResolutionFromCapabilities(cam);
        var infoParts = [];
        if (resolution) {
          infoParts.push(resolution);
        }
        if (isIOS()) {
          infoParts.push(_cameraFacingLabel(cam, ci));
        }
        var cameraInfo = infoParts.length ? '<span class="cam-info">' + _escapeHtml(infoParts.join(' / ')) + '</span>' : '';
        html += '<div class="cam-list-item" data-index="' + ci + '">' +
          '<span class="check' + checked + '">✓</span>' +
          '<span class="cam-label">' + _escapeHtml(camName) + '</span>' +
          cameraInfo +
          '</div>';
      }
      itemsEl.innerHTML = html;

      // Attach click handlers
      var items = itemsEl.querySelectorAll('.cam-list-item');
      for (var ii = 0; ii < items.length; ii++) {
        items[ii].addEventListener('click', (function(idx) {
          return function() { Recv.selectCamera(idx); };
        })(ii));
      }

      // Update current camera label in the button bar
      if (labelEl) {
        var cur = _cams[_currentCamIndex];
        labelEl.textContent = cur && cur.label ? cur.label : ('Camera ' + (_currentCamIndex + 1));
      }
    },

    // Select a specific camera by index and switch to it
    selectCamera: function (index) {
      if (index >= _cams.length || index < 0) return;
      if (index === _currentCamIndex) {
        Recv.closeCameraList();
        return;
      }
      Recv._stopCamera();
      _currentCamIndex = index;
      console.log('Selecting camera ' + index + ': ' + (_cams[index].label || '(no label)'));
      Recv._tryCamera(_currentCamIndex);
      Recv.closeCameraList();
    },

    init_video: function (video) {
      _video = video;
      window.addEventListener('resize', _updateCrosshairPositions);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        var msg = 'mediaDevices not supported? :(';
        if (isIOS()) {
          msg = 'Camera API not available on this iOS device. iOS Chrome requires iOS 14.3+. Please use Safari or update iOS.';
        }
        return Recv.set_error(msg);
      }

      // Reset camera list
      _cams = [];
      _currentCamIndex = 0;

      // iOS-specific: enumerateDevices often returns empty labels until permission is granted
      // So on iOS we may need to start camera first to get real device labels
      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        _cams = devices.filter(function(d) { return d.kind == 'videoinput'; });
        console.log('Found cameras:', _cams.length);
        _cams.forEach(function(cam, i) {
          console.log('Camera ' + i + ': ' + (cam.label || '(no label)'));
        });

        // On iOS, if enumerateDevices returns 0 or all labels are empty, request rear camera directly
        var allEmptyLabels = _cams.length > 0 && _cams.every(function(c) { return !c.label; });
        if (_cams.length == 0 || (isIOS() && allEmptyLabels)) {
          if (isIOS()) {
            console.log('iOS: no labeled cameras found, trying rear camera');
            Recv._startCamera(_cameraQualityConstraints({ facingMode: 'environment' }), 0);
            return;
          }
          Recv.set_error("No camera detected. Please connect a camera and refresh.");
          return;
        }

        // try physical cameras first, skip virtual ones
        var virtualKeywords = ['virtual', 'webcast', 'obs', 'manycam', 'snap', 'xsplit'];
        var physicalIndices = [];
        var virtualIndices = [];
        for (var i = 0; i < _cams.length; i++) {
          var label = (_cams[i].label || '').toLowerCase();
          var isVirtual = false;
          for (var j = 0; j < virtualKeywords.length; j++) {
            if (label.indexOf(virtualKeywords[j]) !== -1) {
              isVirtual = true;
              break;
            }
          }
          if (isVirtual) {
            virtualIndices.push(i);
          } else {
            physicalIndices.push(i);
          }
        }
        var tryOrder = physicalIndices.concat(virtualIndices);
        if (isIOS()) {
          tryOrder.sort(function(a, b) {
            return _cameraPreferenceScore(_cams[a], a) - _cameraPreferenceScore(_cams[b], b);
          });
        }
        _currentCamIndex = tryOrder[0] || 0;
        Recv._tryCamera(_currentCamIndex);
      }).catch(function(err) {
        console.log('enumerateDevices error, trying camera directly', err);
        // Rear camera preferred on iOS, basic video elsewhere
        var fallbackConstraints = isIOS()
          ? _cameraQualityConstraints({ facingMode: 'environment' })
          : _cameraQualityConstraints({ facingMode: { ideal: 'environment' } });
        Recv._startCamera(fallbackConstraints, 0);
      });
    },

    watch_for_camera_pause: function () {
      // only call this after our first success
      if (_watchmanEnabled) {
        return;
      }
      _watchmanEnabled = true;

      // ios only for now, since desktop behavior is weird
      if (!isIOS()) {
        return;
      }

      // periodically make sure the camera capture is running
      setInterval(Recv.restart_paused_camera, 1000);
    },

    restart_paused_camera: function () {
      if (!_video) {
        return;
      }

      // if we're still incrementing, do nothing
      if (_counter > _watchmanLastSeen) {
        _watchmanLastSeen = _counter;
        return;
      }

      // if not, we're stuck?
      Recv.init_video(_video);
    },

    download_bytes: function (buff, name) {
      var blob = new Blob([buff], { type: 'application/octet-stream' });
      Zstd.download_blob(name, blob);
    },

    on_decode: function (wid, data) {
      //console.log('Main thread received message from worker' + wid + ':', data);
      if (data.ready) {
        _workersReadyCount++;
        console.log('[Decode] Worker ' + wid + ' ready (' + _workersReadyCount + '/' + _workers.length + ')');
        if (_workerReady)
          _workerReady();
        return;
      }
      Recv.frames_in_flight_decr();
      // if extract but no bytes, log extract counte
      if (data.nodata) {
        _recentExtract = _counter;
        return;
      }
      if (data.failed_extract) { // very common, nothing to do
        return;
      }
      // Handle "no wasm" / error messages that don't carry a data.buff
      if (data.error || !data.buff) {
        console.warn('[Decode] Worker ' + wid + ' not ready or error:', data.res || data.error);
        return;
      }

      // should be a decode with some bytes, so set decodecounter
      _recentDecode = _counter;

      const buff = data.buff;
      if (buff.length > 0) {
        Recv.setMode(data.mode); // call *before* we send it to the sink. This is our autodetect confirm.
      }
      Recv.set_HTML("t" + wid, "mode is " + _mode + ", len() is " + buff.length);
      Sink.on_decode(buff);
    },

    on_frame: async function (now, metadata) {
      //console.log("on frame");
      // https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame

      _counter += 1;
      if (_workers.length == 0) {
        _video.requestVideoFrameCallback(Recv.on_frame);
        return;
      }
      // Don't send frames until at least one worker's WASM is initialized
      if (_workersReadyCount == 0) {
        _video.requestVideoFrameCallback(Recv.on_frame);
        return;
      }
      if (_nextWorker >= _workers.length)
        _nextWorker = 0;

      // piggyback off this call to make sure our visual state is correct
      Recv.update_visual_state();
      // make sure the camera feed stays up
      Recv.watch_for_camera_pause();

      const modeVals = [66, 68, 67, 4];

      var vf = undefined;
      if (_framesInFlight > 20) {
        console.log("stalling, worker queues are full");
      }
      else {
        Recv.frames_in_flight_incr();
        try {
          vf = new VideoFrame(_video, { timestamp: now });
          const width = vf.displayWidth;
          const height = vf.displayHeight;
          Recv.set_HTML("errorbox", vf.format, true);

          // try to use the default format, but only if we can decode it...
          let vfparams = {};
          if (!_supportedFormats.includes(vf.format)) {
            vfparams.format = "RGBA";
          }
          const size = vf.allocationSize(vfparams);
          const buff = new Uint8Array(size);
          await vf.copyTo(buff, vfparams);

          let format = vfparams.format || vf.format;
          if (format == "RGBA" && size != width * height * 4) {
            format = vf.format; //fallback
          }
          if (_captureNextFrame == 1) {
            _captureNextFrame = 0;
            Recv.download_bytes(buff, width + "x" + height + "x" + _counter + "." + format);
          }

          let mode = _mode || modeVals[_counter % modeVals.length];
          _workers[_nextWorker].postMessage({ type: 'proc', pixels: buff, format: format, width: width, height: height, mode: mode }, [buff.buffer]);
        } catch (e) {
          // VideoFrame API not available (common on older iOS / WKWebView).
          // Fall back to Canvas 2D capture.
          console.warn('VideoFrame failed, using Canvas fallback:', e && e.message ? e.message : e);
          Recv.set_HTML("errorbox", 'Canvas fallback', true);
          var postedFallbackFrame = false;
          try {
            if (!_captureCanvas) {
              _captureCanvas = document.createElement('canvas');
              _captureCtx = _captureCanvas.getContext('2d', { willReadFrequently: true });
            }
            var cw = _video.videoWidth;
            var ch = _video.videoHeight;
            if (cw > 0 && ch > 0) {
              _captureCanvas.width = cw;
              _captureCanvas.height = ch;
              _captureCtx.drawImage(_video, 0, 0);
              var imgData = _captureCtx.getImageData(0, 0, cw, ch);
              var fmt = 'RGBA';
              var md = _mode || modeVals[_counter % modeVals.length];
              _workers[_nextWorker].postMessage({ type: 'proc', pixels: imgData.data, format: fmt, width: cw, height: ch, mode: md }, [imgData.data.buffer]);
              postedFallbackFrame = true;
            }
          } catch (e2) {
            console.error('Canvas fallback also failed:', e2);
            Recv.set_HTML("errorbox", 'Frame error: ' + e2.message, true);
          }
          if (!postedFallbackFrame) {
            Recv.frames_in_flight_decr();
          }
        }
        _nextWorker += 1;
      }
      if (vf)
        vf.close();

      // schedule the next one
      _video.requestVideoFrameCallback(Recv.on_frame);
    },

    captureFrame: function () {
      _captureNextFrame = 1;
      alert("about to capture!");
    },

    download_bytes: function (buff, name) {
      var blob = new Blob([buff], { type: 'application/octet-stream' });
      Zstd.download_blob(name, blob);
    },

    update_visual_state: function () {
      _updateCrosshairPositions();

      // check counters
      var xh1 = document.getElementById("crosshair1");
      var xh2 = document.getElementById("crosshair2");
      if (_recentDecode > 0 && _recentDecode + 30 > _counter) {
        xh1.classList.add("active_xhairs");
        xh1.classList.remove("scanning_xhairs");
        xh2.classList.add("active_xhairs");
        xh1.classList.remove("scanning_xhairs");
      }
      else if (_recentExtract > 0 && _recentExtract + 30 > _counter) {
        xh1.classList.add("scanning_xhairs");
        xh1.classList.remove("active_xhairs");
        xh2.classList.add("scanning_xhairs");
        xh2.classList.remove("active_xhairs");
      }
      else { // inactive
        xh1.classList.remove("active_xhairs");
        xh1.classList.remove("scanning_xhairs");
        xh2.classList.remove("active_xhairs");
        xh2.classList.remove("scanning_xhairs");
      }
    },

    render_progress: function (report) {
      Recv.set_HTML("tdec", "progress " + report);
      const progress_container = document.getElementById('progress_bars');
      const query = '#progress_bars > div[class="progress"]';
      const prev = document.querySelectorAll(query);

      if (!prev || prev.length < report.length) {
        for (var i = (prev ? prev.length : 0); i < report.length; i++) {
          var aaa = document.createElement('div');
          aaa.classList.add("progress");
          progress_container.appendChild(aaa);
        }
      }
      else if (report.length < prev.length) {
        for (var i = report.length; i < prev.length; i++) {
          prev[i].remove();
        }
      }

      const current = document.querySelectorAll(query);
      for (var i = 0; i < report.length; i++) {
        current[i].style.width = report[i] * 100 + "%";
      }
    },

    toggleFullscreen: function () {
      _toggleFullscreen();
    },

    showDebug: function () {
      var btn = document.getElementById("debug-button");
      if (btn) btn.focus();
    },

    clickNav: function () {
      var btn = document.getElementById("nav-button");
      if (btn) btn.focus();
    },

    blurNav: function (pause) {
      if (pause === undefined) {
        pause = true;
      }
      var btn = document.getElementById("nav-button");
      if (btn) btn.blur();
      var content = document.getElementById("nav-content");
      if (content) content.blur();
    },

    setMode: function (modeVal) {
      // these should be moved elsewhere...
      const modeToString = {
        4: "4C",
        8: "8C",
        66: "Bu",
        67: "Bm",
        68: "B"
      };
      let modeStringToVal = {
        "Auto": 0
      };
      for (const val in modeToString) {
        modeStringToVal[modeToString[val]] = val;
      }

      if (modeVal in modeStringToVal) {
        modeVal = modeStringToVal[modeVal];
      }

      // configure wasm in main thread
      _mode = modeVal;
      if (_mode > 0) {
        Module._cimbard_configure_decode(_mode);
        Sink.allocate();
      }

      var modeEl = document.getElementById("mode-val");
      if (modeEl && _mode > 0) {
        modeEl.innerHTML = modeToString[_mode];
      }

      var navEl = document.getElementById("nav-container");
      if (navEl) {
        if (_mode == 0) {
          navEl.classList.add("mode-auto");
          navEl.classList.remove("mode-b");
        } else {
          navEl.classList.add("mode-b");
          navEl.classList.remove("mode-auto");
        }
      }
    },

    set_HTML: function (id, msg, only_if_unset) {
      const elem = document.getElementById(id);
      if (only_if_unset && elem.innerHTML) {
        return;
      }
      elem.innerHTML = msg;
    },

    set_title: function (msg) {
      document.title = "Cimbar: " + msg;
    },

    startCamera: function () {
      var video = Recv._videoEl;
      if (!video) {
        console.error('Video element not found');
        return;
      }
      // Hide the start overlay
      var overlay = document.getElementById('start-overlay');
      if (overlay) overlay.classList.add('hidden');
      // Init camera (triggers permission dialog via user gesture)
      Recv.init_video(video);
    },

    toggleDebugPanel: function () {
      var panel = document.getElementById('debug-panel');
      var backdrop = document.getElementById('debug-backdrop');
      if (!panel) return;
      var isOpen = panel.classList.contains('open');
      if (isOpen) {
        panel.classList.remove('open');
        if (backdrop) backdrop.classList.remove('open');
      } else {
        Recv.refreshLog();
        panel.classList.add('open');
        if (backdrop) backdrop.classList.add('open');
      }
    },

    refreshLog: function () {
      var el = document.getElementById('debug-log');
      if (!el) return;
      var html = '';
      for (var i = 0; i < _logBuffer.length; i++) {
        var line = _logBuffer[i];
        html += '<div class="log-' + line.type + '">' + _escapeHtml(line.text) + '</div>';
      }
      el.innerHTML = html;
      el.scrollTop = el.scrollHeight;
    },

    copyLog: function () {
      var text = '';
      for (var i = 0; i < _logBuffer.length; i++) {
        text += _logBuffer[i].text + '\n';
      }
      if (!text) {
        console.log('Nothing to copy');
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          console.log('Log copied to clipboard');
        }).catch(function (err) {
          console.error('Copy failed: ' + err);
          Recv._fallbackCopy(text);
        });
      } else {
        Recv._fallbackCopy(text);
      }
    },

    _fallbackCopy: function (text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        console.log('Log copied (fallback)');
      } catch (e) {
        console.error('Copy failed: ' + e);
      }
      document.body.removeChild(ta);
    },

    clearLog: function () {
      _logBuffer.length = 0;
      var el = document.getElementById('debug-log');
      if (el) el.innerHTML = '';
    }
  };
}();

function _escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
