import 'package:flutter/material.dart';

/// Connect branding + light/dark themes.
class AppTheme {
  static const accent = Color(0xFF00A884);
  static const accentDark = Color(0xFF008069);
  static const bubbleOutLight = Color(0xFFD9FDD3);
  static const bubbleOutDark = Color(0xFF005C4B);

  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness b) {
    final scheme = ColorScheme.fromSeed(
      seedColor: accent,
      brightness: b,
    );
    final dark = b == Brightness.dark;
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: dark ? const Color(0xFF0B141A) : const Color(0xFFF0F2F5),
      appBarTheme: AppBarTheme(
        backgroundColor: dark ? const Color(0xFF111B21) : accent,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: accent,
        foregroundColor: Colors.white,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: dark ? const Color(0xFF202C33) : Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
    );
  }

  static Color bubbleOut(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark ? bubbleOutDark : bubbleOutLight;

  static Color bubbleIn(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark
          ? const Color(0xFF202C33)
          : Colors.white;

  static Color chatBg(BuildContext c) =>
      Theme.of(c).brightness == Brightness.dark
          ? const Color(0xFF0B141A)
          : const Color(0xFFECE5DD);

  static const avatarPalette = [
    Color(0xFF00A884), Color(0xFF7F66FF), Color(0xFFFF7A59),
    Color(0xFF38B6FF), Color(0xFFE86AB0), Color(0xFFFFB020),
  ];

  static Color avatarColor(String? seed) {
    if (seed == null || seed.isEmpty) return avatarPalette.first;
    return avatarPalette[seed.hashCode.abs() % avatarPalette.length];
  }
}
