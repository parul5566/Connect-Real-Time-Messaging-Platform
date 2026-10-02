import 'package:flutter/material.dart';
import '../core/api.dart';
import '../core/secure_store.dart';
import '../core/socket_service.dart';
import '../core/call_service.dart';
import '../core/theme.dart';

/// Global app state: session, profile, theme mode.
class AppState extends ChangeNotifier {
  Map<String, dynamic>? me;
  ThemeMode themeMode = ThemeMode.system;
  bool booted = false;
  bool hasPin = false;
  bool pinVerified = false;

  bool get loggedIn => me != null;

  Future<void> boot() async {
    Api.init();
    final token = await SecureStore.readToken();
    if (token != null && token.isNotEmpty) {
      try {
        final r = await Api.dio.get('/users/me');
        me = (r.data as Map).cast<String, dynamic>();
        hasPin = me?['has_pin'] == true;
        pinVerified = !hasPin;
        await SocketService.connect();
        CallService.instance.bind();
      } catch (_) {
        await logout(silent: true);
      }
    }
    booted = true;
    notifyListeners();
  }

  Future<void> setSession(String token, Map<String, dynamic> user) async {
    await SecureStore.saveToken(token);
    await SecureStore.saveUser(user.toString());
    me = user;
    hasPin = user['has_pin'] == true;
    pinVerified = !hasPin;
    await SocketService.connect();
    CallService.instance.bind();
    notifyListeners();
  }

  Future<void> refreshMe() async {
    if (!loggedIn) return;
    try {
      final r = await Api.dio.get('/users/me');
      me = (r.data as Map).cast<String, dynamic>();
      hasPin = me?['has_pin'] == true;
      notifyListeners();
    } on Unauthorized {
      rethrow;
    } catch (_) {}
  }

  Future<void> logout({bool silent = false}) async {
    await SecureStore.clear();
    await SocketService.disconnect();
    me = null;
    pinVerified = false;
    hasPin = false;
    if (!silent) notifyListeners();
  }

  void setThemeMode(ThemeMode m) {
    themeMode = m;
    notifyListeners();
  }

  void markPinVerified() {
    pinVerified = true;
    notifyListeners();
  }

  Color avatarColorFor(String? seed) => AppTheme.avatarColor(seed);
}

class Unauthorized implements Exception {}
