import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../core/api.dart';
import 'socket_service.dart';

/// Call phase shown by the call overlay / call screen.
enum CallPhase {
  idle,
  incoming, // ringing, waiting for callee decision
  outgoing, // ringing on the other side
  connecting, // accepted, negotiating SDP
  connected,
  ended,
}

/// WebRTC call state machine wired to the backend's Socket.IO signaling
/// (call:ring / accepted / declined / cancelled / ended / sdp / ice) —
/// the same events the web client already consumes.
class CallService extends ChangeNotifier {
  static final CallService instance = CallService._();

  CallService._();

  CallPhase phase = CallPhase.idle;
  String? callId;
  int? remoteUserId;
  String remoteName = '';
  String? remoteAvatarColor;
  bool isVideo = false;
  bool outgoing = false;
  String? errorText;

  MediaStream? localStream;
  MediaStream? remoteStream;

  bool micMuted = false;
  bool speakerOn = true;
  bool camOff = false;
  bool usingFrontCam = true;

  RTCPeerConnection? _pc;
  final List<Map<String, dynamic>> _pendingIce = [];
  Timer? _ringback;
  Timer? _tick;
  DateTime? _connectedAt;
  Duration elapsed = Duration.zero;
  bool _wired = false;
  bool _ending = false;

  static const _iceServers = [
    {'urls': 'stun:stun.l.google.com:19302'},
  ];

  /// Attach socket listeners once per login.
  void bind() {
    if (_wired) return;
    _wired = true;
    SocketService.on<Map<String, dynamic>>('call:ring').listen(_onRing);
    SocketService.on<Map<String, dynamic>>('call:accepted').listen(_onAccepted);
    SocketService.on<Map<String, dynamic>>('call:declined').listen(_onDeclined);
    SocketService.on<Map<String, dynamic>>('call:cancelled').listen(_onCancelled);
    SocketService.on<Map<String, dynamic>>('call:ended').listen(_onEnded);
    SocketService.on<Map<String, dynamic>>('call:sdp').listen(_onSdp);
    SocketService.on<Map<String, dynamic>>('call:ice').listen(_onIce);
  }

  // ---------- Caller ----------
  Future<void> start({
    required int calleeId,
    required String name,
    String? avatarColor,
    required bool video,
  }) async {
    if (phase != CallPhase.idle && phase != CallPhase.ended) {
      throw 'Already in a call';
    }
    final res = await Api.dio.post('/calls', data: {
      'calleeId': calleeId,
      'type': video ? 'video' : 'voice',
    });
    final data = (res.data as Map).cast<String, dynamic>();
    if (data['calleeOnline'] != true) {
      throw 'User is offline';
    }
    callId = data['callId']?.toString();
    remoteUserId = calleeId;
    remoteName = name;
    remoteAvatarColor = avatarColor;
    isVideo = video;
    outgoing = true;
    errorText = null;
    phase = CallPhase.outgoing;
    notifyListeners();

    final ok = await _openMedia(video);
    if (!ok) {
      await _reportOutcome('failed');
      _reset();
      notifyListeners();
      return;
    }
    // Caller keeps the connection ready and waits for the offer answer;
    // the actual offer is created on call:accepted (parity with web client).
    _startRingbackTimeout();
  }

  // ---------- Callee ----------
  void _onRing(Map<String, dynamic> p) {
    if (phase == CallPhase.incoming ||
        phase == CallPhase.outgoing ||
        phase == CallPhase.connecting ||
        phase == CallPhase.connected) {
      // Busy — auto-cancel so the caller gets feedback.
      SocketService.emit('call:cancel', {
        'callId': p['callId'],
        'to': p['callerId'],
      });
      return;
    }
    callId = p['callId']?.toString();
    remoteUserId = (p['callerId'] as num?)?.toInt();
    remoteName = (p['callerName'] as String?) ?? 'Contact';
    isVideo = p['type'] == 'video';
    outgoing = false;
    errorText = null;
    phase = CallPhase.incoming;
    notifyListeners();
  }

  Future<void> accept() async {
    if (phase != CallPhase.incoming || callId == null) return;
    final ok = await _openMedia(isVideo);
    if (!ok) {
      await decline();
      return;
    }
    phase = CallPhase.connecting;
    notifyListeners();
    SocketService.emit('call:accept', {
      'callId': callId,
      'to': remoteUserId,
    });
    _startTick();
  }

  Future<void> decline() async {
    if (callId != null && remoteUserId != null) {
      SocketService.emit('call:decline', {
        'callId': callId,
        'to': remoteUserId,
      });
    }
    _teardownMedia();
    _reset();
    notifyListeners();
  }

  // ---------- SDP / ICE ----------
  Future<void> _onAccepted(Map<String, dynamic> p) async {
    if (!outgoing || phase == CallPhase.connected) return;
    phase = CallPhase.connecting;
    notifyListeners();
    await _ensurePeer();
    final offer = await _pc!.createOffer();
    await _pc!.setLocalDescription(offer);
    SocketService.emit('call:sdp', {
      'to': remoteUserId,
      'sdp': {'type': 'offer', 'sdp': offer.sdp},
    });
    _flushIce();
    _startTick();
  }

  Future<void> _onSdp(Map<String, dynamic> p) async {
    if (remoteUserId == null ||
        (p['from'] as num?)?.toInt() != remoteUserId) {
      return;
    }
    final sdp = p['sdp'] as Map<String, dynamic>?;
    if (sdp == null) return;
    if (sdp['type'] == 'offer') {
      await _ensurePeer();
      await _pc!.setRemoteDescription(
        RTCSessionDescription(sdp['sdp'] as String, 'offer'),
      );
      final answer = await _pc!.createAnswer();
      await _pc!.setLocalDescription(answer);
      SocketService.emit('call:sdp', {
        'to': remoteUserId,
        'sdp': {'type': 'answer', 'sdp': answer.sdp},
      });
      _flushIce();
      _startTick();
    } else if (sdp['type'] == 'answer' && _pc != null) {
      await _pc!.setRemoteDescription(
        RTCSessionDescription(sdp['sdp'] as String, 'answer'),
      );
      _flushIce();
    }
  }

  Future<void> _onIce(Map<String, dynamic> p) async {
    if (remoteUserId == null ||
        (p['from'] as num?)?.toInt() != remoteUserId) {
      return;
    }
    final cand = p['candidate'];
    if (cand == null) return;
    final remoteDesc = await _pc!.getRemoteDescription();
    if (remoteDesc == null) {
      _pendingIce.add({'candidate': cand});
      return;
    }
    try {
      await _pc!.addCandidate(RTCIceCandidate(
        cand['candidate'] as String?,
        cand['sdpMid'] as String?,
        (cand['sdpMLineIndex'] as num?)?.toInt(),
      ));
    } catch (_) {}
  }

  Future<void> _flushIce() async {
    if (_pendingIce.isEmpty) return;
    final list = List<Map<String, dynamic>>.from(_pendingIce);
    _pendingIce.clear();
    for (final c in list) {
      final cand = c['candidate'] as Map<String, dynamic>;
      try {
        await _pc!.addCandidate(RTCIceCandidate(
          cand['candidate'] as String?,
          cand['sdpMid'] as String?,
          (cand['sdpMLineIndex'] as num?)?.toInt(),
        ));
      } catch (_) {}
    }
  }

  // ---------- Lifecycle ----------
  Future<void> _onDeclined(Map<String, dynamic> p) async {
    if (!outgoing) return;
    errorText = 'Call declined';
    await end(report: true, status: 'declined');
  }

  Future<void> _onCancelled(Map<String, dynamic> p) async {
    if (outgoing) return;
    if (phase == CallPhase.incoming) {
      errorText = 'Missed call';
    }
    _teardownMedia();
    _reset();
    notifyListeners();
  }

  Future<void> _onEnded(Map<String, dynamic> p) async {
    if (phase == CallPhase.idle) return;
    errorText = 'Call ended';
    await end(report: false);
  }

  Future<void> end({bool report = true, String? status}) async {
    if (_ending) return;
    _ending = true;
    if (report && callId != null && remoteUserId != null) {
      SocketService.emit('call:end', {
        'callId': callId,
        'to': remoteUserId,
        'duration': elapsed.inSeconds,
      });
    }
    if (report || status != null) {
      await _reportOutcome(status ?? 'completed');
    }
    _teardownMedia();
    _reset();
    notifyListeners();
    Future.delayed(const Duration(seconds: 2), () {
      _ending = false;
    });
  }

  Future<void> hangUp() => end(report: true);

  Future<void> _reportOutcome(String status) async {
    if (callId == null) return;
    final duration = status == 'completed' ? elapsed.inSeconds : 0;
    try {
      await Api.dio.post('/calls/$callId/outcome', data: {
        'status': status,
        if (duration > 0) 'duration_secs': duration,
      });
    } catch (_) {}
  }

  Future<bool> _openMedia(bool video) async {
    try {
      final stream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        if (video) 'video': {
          'facingMode': 'user',
          'width': {'ideal': 1280},
          'height': {'ideal': 720},
        },
      });
      localStream = stream;
      if (video) {
        await Helper.setSpeakerphoneOn(true);
      }
      return true;
    } catch (_) {
      errorText =
          'Could not access ${video ? 'camera/microphone' : 'microphone'}';
      return false;
    }
  }

  Future<void> _ensurePeer() async {
    if (_pc != null) return;
    final pc = await createPeerConnection({'iceServers': _iceServers});
    _pc = pc;
    localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream!));
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        remoteStream = event.streams.first;
        if (phase != CallPhase.connected) {
          phase = CallPhase.connected;
          _connectedAt ??= DateTime.now();
          notifyListeners();
        }
      }
    };
    pc.onIceCandidate = (candidate) {
      SocketService.emit('call:ice', {
        'to': remoteUserId,
        'candidate': candidate.toMap(),
      });
    };
    pc.onConnectionState = (state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected &&
          phase != CallPhase.connected) {
        phase = CallPhase.connected;
        _connectedAt ??= DateTime.now();
        notifyListeners();
      }
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        errorText = 'Connection failed';
        end(report: true, status: 'failed');
      }
    };
  }

  void _startTick() {
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (_connectedAt != null) {
        elapsed = DateTime.now().difference(_connectedAt!);
        notifyListeners();
      }
    });
  }

  void _startRingbackTimeout() {
    _ringback?.cancel();
    _ringback = Timer(const Duration(seconds: 45), () {
      if (phase == CallPhase.outgoing || phase == CallPhase.incoming) {
        errorText = 'No answer';
        end(report: true, status: 'missed');
      }
    });
  }

  void _teardownMedia() {
    _ringback?.cancel();
    _tick?.cancel();
    try {
      _pc?.close();
    } catch (_) {}
    _pc = null;
    try {
      localStream?.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    try {
      remoteStream?.getTracks().forEach((t) => t.stop());
    } catch (_) {}
    localStream = null;
    remoteStream = null;
  }

  void _reset() {
    phase = CallPhase.idle;
    callId = null;
    remoteUserId = null;
    remoteName = '';
    remoteAvatarColor = null;
    outgoing = false;
    isVideo = false;
    micMuted = false;
    speakerOn = true;
    camOff = false;
    usingFrontCam = true;
    elapsed = Duration.zero;
    _connectedAt = null;
    _pendingIce.clear();
  }

  // ---------- Controls ----------
  Future<void> toggleMute() async {
    micMuted = !micMuted;
    localStream?.getAudioTracks().forEach((t) => t.enabled = !micMuted);
    notifyListeners();
  }

  Future<void> toggleSpeaker() async {
    speakerOn = !speakerOn;
    await Helper.setSpeakerphoneOn(speakerOn);
    notifyListeners();
  }

  Future<void> toggleCamera() async {
    camOff = !camOff;
    localStream?.getVideoTracks().forEach((t) => t.enabled = !camOff);
    notifyListeners();
  }

  Future<void> switchCamera() async {
    final track = localStream?.getVideoTracks().firstOrNull;
    if (track != null) {
      await Helper.switchCamera(track);
    }
    usingFrontCam = !usingFrontCam;
    notifyListeners();
  }
}
