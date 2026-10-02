import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Secure storage for the JWT and cached user profile.
/// Never use SharedPreferences for tokens.
class SecureStore {
  static const _storage = FlutterSecureStorage();

  static const _tokenKey = 'connect_jwt';
  static const _userKey = 'connect_user';

  static Future<void> saveToken(String token) =>
      _storage.write(key: _tokenKey, value: token);

  static Future<String?> readToken() => _storage.read(key: _tokenKey);

  static Future<void> saveUser(String userJson) =>
      _storage.write(key: _userKey, value: userJson);

  static Future<String?> readUser() => _storage.read(key: _userKey);

  static Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _userKey);
  }
}
