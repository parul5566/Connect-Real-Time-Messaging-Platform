import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'state/app_state.dart';
import 'core/theme.dart';
import 'core/api.dart';
import 'core/call_service.dart';
import 'screens/shell_screen.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/pin_lock_screen.dart';
import 'screens/auth/splash_screen.dart';
import 'screens/calls/call_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AppState()),
        ChangeNotifierProvider(create: (_) => CallService.instance),
      ],
      child: const ConnectApp(),
    ),
  );
}

class ConnectApp extends StatelessWidget {
  const ConnectApp({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return MaterialApp(
      title: 'Connect',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: app.themeMode,
      home: const _Root(),
    );
  }
}

class _Root extends StatefulWidget {
  const _Root();

  @override
  State<_Root> createState() => _RootState();
}

class _RootState extends State<_Root> {
  @override
  void initState() {
    super.initState();
    onUnauthorized = () {
      final app = context.read<AppState>();
      app.logout();
    };
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AppState>().boot();
    });
  }

  @override
  void dispose() {
    onUnauthorized = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    if (!app.booted) return const SplashScreen();
    if (!app.loggedIn) return const LoginScreen();
    if (app.hasPin && !app.pinVerified) return const PinLockScreen();

    final call = context.watch<CallService>();
    if (call.phase == CallPhase.incoming ||
        call.phase == CallPhase.outgoing ||
        call.phase == CallPhase.connecting ||
        call.phase == CallPhase.connected) {
      return const CallScreen();
    }
    return const ShellScreen();
  }
}
