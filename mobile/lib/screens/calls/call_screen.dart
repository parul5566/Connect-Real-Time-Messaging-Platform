import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:provider/provider.dart';
import '../../core/call_service.dart';
import '../../core/theme.dart';

/// Full-screen call experience: incoming ringing, outgoing ringback,
/// connecting, and in-call audio/video with controls.
class CallScreen extends StatefulWidget {
  const CallScreen({super.key});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  @override
  void initState() {
    super.initState();
    final call = context.read<CallService>();
    call.addListener(_onChange);
    // Incoming calls are answered from the ring overlay; nothing to auto-run.
  }

  @override
  void dispose() {
    // Listener removed via call.removeListener in a safe way.
    try {
      context.read<CallService>().removeListener(_onChange);
    } catch (_) {}
    super.dispose();
  }

  void _onChange() {
    if (!mounted) return;
    final call = context.read<CallService>();
    if (call.phase == CallPhase.idle) {
      Navigator.of(context).maybePop();
    } else {
      setState(() {});
    }
  }

  String _status(CallService call) {
    switch (call.phase) {
      case CallPhase.incoming:
        return 'Incoming ${call.isVideo ? 'video' : 'voice'} call';
      case CallPhase.outgoing:
        return 'Ringing…';
      case CallPhase.connecting:
        return 'Connecting…';
      case CallPhase.connected:
        final s = call.elapsed;
        final m = s.inMinutes.remainder(60).toString().padLeft(2, '0');
        final sec = s.inSeconds.remainder(60).toString().padLeft(2, '0');
        final h = s.inHours;
        return h > 0 ? '$h:$m:$sec' : '$m:$sec';
      case CallPhase.ended:
        return call.errorText ?? 'Call ended';
      case CallPhase.idle:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final call = context.watch<CallService>();
    final dark = Theme.of(context).brightness == Brightness.dark;
    final avatar = AppTheme.avatarColor(
        call.remoteAvatarColor ?? call.remoteName);

    Widget body;
    if (call.isVideo && (call.phase == CallPhase.connected ||
        call.phase == CallPhase.connecting)) {
      body = _videoBody(call);
    } else {
      body = _audioBody(call, avatar);
    }

    return Scaffold(
      backgroundColor: dark ? const Color(0xFF0B141A) : AppTheme.accentDark,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 24),
              child: Column(
                children: [
                  Text(call.remoteName,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  Text(_status(call),
                      style: TextStyle(
                          color: Colors.white.withValues(alpha: 0.75),
                          fontSize: 15)),
                ],
              ),
            ).animate().fadeIn(),
            Expanded(child: body),
            _controls(call),
          ],
        ),
      ),
    );
  }

  Widget _videoBody(CallService call) {
    _syncRenderers(call);
    final remote = _remoteR;
    return Stack(
      children: [
        Positioned.fill(
          child: (remote != null && call.remoteStream != null)
              ? RTCVideoView(remote,
                  objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover)
              : const Center(
                  child: CircularProgressIndicator(color: Colors.white)),
        ),
        Positioned(
          top: 12,
          right: 12,
          width: 110,
          height: 160,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: (_localR != null && call.localStream != null && !call.camOff)
                ? RTCVideoView(_localR!,
                    mirror: call.usingFrontCam,
                    objectFit:
                        RTCVideoViewObjectFit.RTCVideoViewObjectFitCover)
                : Container(
                    color: Colors.black54,
                    child: const Icon(Icons.videocam_off_rounded,
                        color: Colors.white70)),
          ),
        ),
      ],
    );
  }

  /// Streams being rendered, one renderer per stream for the screen's life.
  final Map<MediaStream, RTCVideoRenderer> _renderers = {};
  RTCVideoRenderer? _remoteR;
  RTCVideoRenderer? _localR;

  void _syncRenderers(CallService call) {
    final remote = call.remoteStream;
    if (remote != null && !_renderers.containsKey(remote)) {
      final r = RTCVideoRenderer();
      _renderers[remote] = r;
      r.initialize().then((_) {
        r.srcObject = remote;
        if (mounted) setState(() {});
      });
      _remoteR = r;
    }
    if (_remoteR == null && _renderers.isNotEmpty) {
      _remoteR = _renderers.keys
          .map((k) => _renderers[k]!)
          .firstWhere((_) => true);
    }
    final local = call.localStream;
    if (local != null && !_renderers.containsKey(local)) {
      final r = RTCVideoRenderer();
      _renderers[local] = r;
      r.initialize().then((_) {
        r.srcObject = local;
        if (mounted) setState(() {});
      });
      _localR = r;
    }
    // Drop renderers of streams the service has torn down.
    _renderers.removeWhere((stream, _) {
      final dead = (stream == local && call.localStream != local) ||
          (stream == remote && call.remoteStream != remote) ||
          (stream != call.localStream && stream != call.remoteStream);
      return dead;
    });
    if (_remoteR != null && !_renderers.containsValue(_remoteR)) _remoteR = null;
    if (_localR != null && !_renderers.containsValue(_localR)) _localR = null;
  }

  Widget _audioBody(CallService call, Color avatar) {
    final ringing =
        call.phase == CallPhase.incoming || call.phase == CallPhase.outgoing;
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        CircleAvatar(radius: 56, backgroundColor: avatar,
                child: Text(call.remoteName.isNotEmpty
                        ? call.remoteName[0].toUpperCase()
                        : '?',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 40,
                        fontWeight: FontWeight.bold)))
            .animate(onPlay: (c) => ringing ? c.repeat(reverse: true) : null)
            .scale(
                begin: const Offset(1, 1),
                end: const Offset(1.06, 1.06),
                duration: 900.ms,
                curve: Curves.easeInOut),
        if (call.isVideo && call.phase == CallPhase.incoming)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text('Video call',
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.6))),
          ),
      ],
    );
  }

  Widget _controls(CallService call) {
    final incoming = call.phase == CallPhase.incoming;
    final active = call.phase == CallPhase.connecting ||
        call.phase == CallPhase.connected;

    Widget btn(IconData icon, String label, VoidCallback? onTap,
        {Color? bg, Color? fg}) {
      return Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton(
            heroTag: 'call-$label',
            onPressed: onTap,
            backgroundColor: bg ?? Colors.white.withValues(alpha: 0.15),
            child: Icon(icon, color: fg ?? Colors.white),
          ),
          const SizedBox(height: 6),
          Text(label,
              style: TextStyle(
                  fontSize: 11,
                  color: Colors.white.withValues(alpha: 0.7))),
        ],
      );
    }

    if (incoming) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 28),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            btn(Icons.call_end_rounded, 'Decline', () => call.decline(),
                bg: const Color(0xFFE5484D)),
            btn(Icons.call_rounded, 'Accept', () => call.accept(),
                bg: const Color(0xFF23B573)),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
      child: Wrap(
        alignment: WrapAlignment.spaceEvenly,
        spacing: 18,
        runSpacing: 14,
        children: [
          if (active || call.phase == CallPhase.outgoing)
            btn(
                call.micMuted
                    ? Icons.mic_off_rounded
                    : Icons.mic_rounded,
                'Mute',
                active ? () => call.toggleMute() : null,
                bg: call.micMuted ? Colors.white : Colors.white24,
                fg: call.micMuted ? Colors.black : Colors.white),
          if (active)
            btn(
                call.speakerOn
                    ? Icons.volume_up_rounded
                    : Icons.volume_off_rounded,
                'Speaker',
                () => call.toggleSpeaker()),
          if (call.isVideo && active)
            btn(
                call.camOff
                    ? Icons.videocam_off_rounded
                    : Icons.videocam_rounded,
                'Camera',
                () => call.toggleCamera()),
          if (call.isVideo && active)
            btn(Icons.cameraswitch_rounded, 'Flip',
                () => call.switchCamera()),
          btn(Icons.call_end_rounded, 'End', () => call.hangUp(),
              bg: const Color(0xFFE5484D)),
        ],
      ),
    );
  }
}
