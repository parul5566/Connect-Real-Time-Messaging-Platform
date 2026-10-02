import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/api.dart';
import '../../core/secure_store.dart';
import '../../state/app_state.dart';
import '../../core/theme.dart';

class PinLockScreen extends StatefulWidget {
  const PinLockScreen({super.key});

  @override
  State<PinLockScreen> createState() => _PinLockScreenState();
}

class _PinLockScreenState extends State<PinLockScreen> {
  String _entry = '';
  String? _error;
  bool _busy = false;

  Future<void> _submit() async {
    setState(() { _busy = true; _error = null; });
    final meJson = await SecureStore.readUser();
    String? phone;
    if (meJson != null) {
      final match = RegExp(r'phone: "([^"]+)"').firstMatch(meJson);
      phone = match?.group(1);
    }
    if (phone == null) {
      // Fall back to a fresh login if we can't recover the phone.
      if (!mounted) return;
      await context.read<AppState>().logout();
      return;
    }
    try {
      final res = await Api.verifyPin(phone, _entry);
      if (!mounted) return;
      final app = context.read<AppState>();
      await app.setSession(
          res['token'] as String, (res['user'] as Map).cast<String, dynamic>());
      app.markPinVerified();
    } catch (e) {
      setState(() {
        _error = Api.errMsg(e);
        _entry = '';
        _busy = false;
      });
    }
  }

  void _tap(String d) {
    if (_busy) return;
    if (_entry.length >= 8) return;
    setState(() => _entry += d);
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      backgroundColor: dark ? const Color(0xFF0B141A) : AppTheme.accentDark,
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock_rounded, size: 56, color: Colors.white),
              const SizedBox(height: 12),
              const Text('Enter your PIN',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 28),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(6, (i) {
                  final filled = i < _entry.length;
                  return Container(
                    margin: const EdgeInsets.symmetric(horizontal: 6),
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: filled
                          ? Colors.white
                          : Colors.white.withValues(alpha: 0.25),
                    ),
                  ).animate(target: filled ? 1 : 0).scale(duration: 150.ms);
                }),
              ),
              const SizedBox(height: 12),
              if (_error != null)
                Text(_error!,
                        style: const TextStyle(color: Color(0xFFFFB4AB)))
                    .animate()
                    .shake(duration: 300.ms),
              const SizedBox(height: 24),
              if (!_busy) _pad() else
                const Padding(
                  padding: EdgeInsets.all(24),
                  child: CircularProgressIndicator(color: Colors.white),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pad() {
    final keys = [
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
      '✓', '0', '⌫',
    ];
    return SizedBox(
      width: 260,
      child: Column(
        children: [
          for (final row in [keys.sublist(0, 3), keys.sublist(3, 6),
                keys.sublist(6, 9), keys.sublist(9, 12)])
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                for (final k in row)
                  Padding(
                    padding: const EdgeInsets.all(6),
                    child: k.isEmpty
                        ? const SizedBox(width: 68, height: 68)
                        : SizedBox(
                            width: 68,
                            height: 68,
                            child: k == '⌫'
                                ? IconButton(
                                    onPressed: () => setState(() {
                                      if (_entry.isNotEmpty) {
                                        _entry =
                                            _entry.substring(0, _entry.length - 1);
                                      }
                                    }),
                                    icon: const Icon(Icons.backspace_outlined,
                                        color: Colors.white),
                                  )
                                : k == '✓'
                                    ? IconButton(
                                        onPressed:
                                            _entry.isEmpty ? null : _submit,
                                        icon: const Icon(Icons.check_rounded,
                                            color: Colors.white),
                                      )
                                    : FilledButton(
                                    style: FilledButton.styleFrom(
                                      backgroundColor:
                                          Colors.white.withValues(alpha: 0.12),
                                      foregroundColor: Colors.white,
                                      shape: const CircleBorder(),
                                    ),
                                    onPressed: () => _tap(k),
                                    child: Text(k,
                                        style: const TextStyle(fontSize: 22)),
                                      ),
                          ),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}
