import 'package:dio/dio.dart';
import 'config.dart';
import 'secure_store.dart';

/// Callback fired when the backend rejects the session (401).
void Function()? onUnauthorized;

class Api {
  static final Dio dio = Dio(BaseOptions(
    baseUrl: '${Config.httpBase}/api',
    connectTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 60),
    headers: {'Accept': 'application/json'},
  ));

  static bool _wired = false;

  static void init() {
    if (_wired) return;
    _wired = true;
    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await SecureStore.readToken();
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (e, handler) {
        if (e.response?.statusCode == 401) onUnauthorized?.call();
        handler.next(e);
      },
    ));
  }

  // ---- Auth ----
  static Future<Map<String, dynamic>> requestOtp(String phone) async {
    final r = await dio.post('/auth/request-otp', data: {'phone': phone});
    return (r.data as Map).cast<String, dynamic>();
  }

  static Future<Map<String, dynamic>> verifyOtp({
    required String phone,
    required String code,
    String? name,
    String? pin,
  }) async {
    final r = await dio.post('/auth/verify-otp', data: {
      'phone': phone,
      'code': code,
      if (name != null && name.isNotEmpty) 'name': name,
      if (pin != null && pin.isNotEmpty) 'pin': pin,
    });
    return (r.data as Map).cast<String, dynamic>();
  }

  static Future<Map<String, dynamic>> verifyPin(String phone, String pin) async {
    final r = await dio.post('/auth/verify-pin',
        data: {'phone': phone, 'pin': pin});
    return (r.data as Map).cast<String, dynamic>();
  }

  // ---- Calls ----
  static Future<List<Map<String, dynamic>>> getCalls() async {
    final r = await dio.get('/calls');
    return (r.data as List)
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();
  }

  static Future<Map<String, dynamic>> createCall(int calleeId, bool video) async {
    final r = await dio.post('/calls',
        data: {'calleeId': calleeId, 'type': video ? 'video' : 'voice'});
    return (r.data as Map).cast<String, dynamic>();
  }

  /// Throws a readable error message from a DioException.
  static String errMsg(Object e) {
    if (e is DioException) {
      final data = e.response?.data;
      if (data is Map && data['error'] != null) return data['error'].toString();
      if (e.response?.statusCode == 429) {
        return 'Too many attempts. Please wait a while and try again.';
      }
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.connectionError) {
        return 'Cannot reach the server. Check your connection.';
      }
      return 'Request failed (${e.response?.statusCode ?? 'network'})';
    }
    return 'Something went wrong';
  }
}
