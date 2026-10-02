import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/api.dart';
import '../../state/app_state.dart';
import '../../core/theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

enum _Step { phone, otp, name }

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _name = TextEditingController();
  final _pin = TextEditingController();
  _Step _step = _Step.phone;
  bool _busy = false;
  String? _error;
  String? _devCode;

  Future<void> _requestOtp() async {
    final phone = _phone.text.trim();
    if (phone.length < 7) {
      setState(() => _error = 'Enter a valid phone number (7–15 digits)');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      final res = await Api.requestOtp(phone);
      setState(() {
        _devCode = res['devCode']?.toString();
        _step = _Step.otp;
      });
    } catch (e) {
      setState(() => _error = Api.errMsg(e));
    } finally {
      setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    String code = _code.text.trim();
    if (code.length != 6) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      // The first verify consumes the OTP even when it answers name_required,
      // so the name-step submit requests a fresh OTP before retrying.
      if (_step == _Step.name) {
      final fresh = await Api.requestOtp(_phone.text.trim());
      final fc = fresh['devCode']?.toString();
      if (fc != null && fc.isNotEmpty) {
        _code.text = fc;
        code = fc;
      }
      }
      final res = await Api.verifyOtp(
        phone: _phone.text.trim(),
        code: code,
        name: _step == _Step.name ? _name.text.trim() : null,
        pin: _step == _Step.name && _pin.text.isNotEmpty ? _pin.text.trim() : null,
      );
      if (res['error'] == 'name_required') {
        setState(() { _step = _Step.name; _busy = false; });
        return;
      }
      if (res['pin_required'] == true) {
        if (!mounted) return;
        final app = Provider.of<AppState>(context, listen: false);
        final pinRes = await _promptExistingPin();
        if (pinRes == null) { setState(() { _busy = false; }); return; }
        await app.setSession(pinRes['token'] as String,
            (pinRes['user'] as Map).cast<String, dynamic>());
        return;
      }
      if (!mounted) return;
      final app = Provider.of<AppState>(context, listen: false);
      await app.setSession(res['token'] as String,
          (res['user'] as Map).cast<String, dynamic>());
    } catch (e) {
      // New users get a 409 name_required — switch to the name step.
      if (e is DioException &&
          (e.response?.data is Map) &&
          e.response?.data['error'] == 'name_required') {
        setState(() { _step = _Step.name; _busy = false; _error = null; });
        return;
      }
      String msg = Api.errMsg(e);
      if (msg == 'name_required') {
        setState(() { _step = _Step.name; _busy = false; _error = null; });
        return;
      }
      setState(() { _error = msg; _busy = false; });
    }
  }

  Future<Map<String, dynamic>?> _promptExistingPin() async {
    final controller = TextEditingController();
    final res = await showDialog<Map<String, dynamic>>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('Enter your PIN'),
        content: TextField(
          controller: controller,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 8,
          decoration: const InputDecoration(hintText: 'PIN'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              try {
                final r = await Api.verifyPin(
                    _phone.text.trim(), controller.text.trim());
                if (ctx.mounted) Navigator.pop(ctx, r);
              } catch (e) {
                if (ctx.mounted) {
                  ScaffoldMessenger.of(ctx).showSnackBar(
                      SnackBar(content: Text(Api.errMsg(e))));
                }
              }
            },
            child: const Text('Unlock'),
          ),
        ],
      ),
    );
    return res;
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: dark
                ? [const Color(0xFF111B21), const Color(0xFF0B141A)]
                : [AppTheme.accent, AppTheme.accentDark],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Icon(Icons.forum_rounded,
                            size: 64, color: Colors.white)
                        .animate(onPlay: (c) => c.repeat(reverse: true))
                        .moveY(begin: -6, end: 6, duration: 1500.ms,
                            curve: Curves.easeInOut),
                    const SizedBox(height: 12),
                    const Text(
                      'Connect',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Colors.white,
                          fontSize: 32,
                          fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 28),
                    _card(dark),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _card(bool dark) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF202C33) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AnimatedSwitcher(
            duration: 300.ms,
            child: _stepTitle(Key(_step.name)),
          ),
          const SizedBox(height: 20),
          if (_step == _Step.phone)
            TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              maxLength: 15,
              decoration: const InputDecoration(
                hintText: 'Phone number',
                prefixIcon: Icon(Icons.phone_rounded),
                counterText: '',
              ),
            ),
          if (_step == _Step.otp) ...[
            TextField(
              controller: _code,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 24, letterSpacing: 4),
              decoration: const InputDecoration(
                hintText: '••••••',
                counterText: '',
              ),
            ),
            if (_devCode != null) ...[
              const SizedBox(height: 8),
              Text('Demo code: $_devCode',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppTheme.accent)),
            ],
            TextButton(
              onPressed: _busy ? null : _requestOtp,
              child: const Text('Resend code'),
            ),
          ],
          if (_step == _Step.name) ...[
            TextField(
              controller: _name,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                hintText: 'Your name',
                prefixIcon: Icon(Icons.person_rounded),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _pin,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 8,
              decoration: const InputDecoration(
                hintText: 'Optional PIN (unlock later)',
                prefixIcon: Icon(Icons.lock_outline_rounded),
                counterText: '',
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!,
                style: const TextStyle(color: Colors.redAccent),
                textAlign: TextAlign.center),
          ],
          const SizedBox(height: 20),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: AppTheme.accent,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            onPressed: _busy
                ? null
                : () {
                    if (_step == _Step.phone) {
                      _requestOtp();
                    } else {
                      _verify();
                    }
                  },
            child: _busy
                ? const SizedBox(
                    width: 22, height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : Text(
                    _step == _Step.phone
                        ? 'Continue'
                        : _step == _Step.otp
                            ? 'Verify'
                            : 'Start chatting',
                    style: const TextStyle(fontSize: 16),
                  ),
          ),
          if (_step != _Step.phone)
            TextButton(
              onPressed: () =>
                  setState(() { _step = _Step.phone; _error = null; }),
              child: const Text('Use a different number'),
            ),
        ],
      ),
    ).animate().fadeIn(duration: 400.ms).slideY(begin: 0.1);
  }

  Widget _stepTitle(Key key) {
    final titles = {
      _Step.phone: 'Welcome to Connect',
      _Step.otp: 'Enter verification code',
      _Step.name: 'Set up your profile',
    };
    return Text(
      titles[_step]!,
      key: key,
      textAlign: TextAlign.center,
      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
    );
  }
}
