import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as sio;
import 'config.dart';
import 'secure_store.dart';

/// Socket.IO service wired to the Connect backend.
/// Auth via handshake.auth.token (JWT). Rooms: `user:<uid>`, `conv:<id>`.
class SocketService {
  static sio.Socket? _socket;
  static final _controllers = <String, StreamController<dynamic>>{};

  static Stream<T> on<T>(String event) {
    _controllers.putIfAbsent(
        event, () => StreamController<dynamic>.broadcast());
    return (_controllers[event] as StreamController<T>).stream;
  }

  static bool get connected => _socket?.connected ?? false;

  static Future<void> connect() async {
    final token = await SecureStore.readToken();
    if (token == null || token.isEmpty) return;
    await disconnect();
    _socket = sio.io(
      Config.httpBase,
      sio.OptionBuilder()
          .setTransports(['websocket'])
          .enableForceNew()
          .setAuth({'token': token})
          .build(),
    );
    const events = [
      'presence', 'typing', 'receipts:update', 'message:new',
      'message:update', 'reaction:update', 'poll:update',
      'conversation:update', 'status:update', 'channels:update',
      'channel:post', 'call:ring', 'call:accepted', 'call:declined',
      'call:cancelled', 'call:ended', 'call:sdp', 'call:ice',
    ];
    for (final ev in events) {
      _socket!.on(ev, (data) {
        final c = _controllers[ev];
        if (c != null && !c.isClosed) c.add(data);
      });
    }
  }

  static void emit(String event, [dynamic data]) {
    _socket?.emit(event, data);
  }

  static Future<void> disconnect() async {
    final s = _socket;
    _socket = null;
    if (s != null) {
      s.dispose();
    }
  }
}
