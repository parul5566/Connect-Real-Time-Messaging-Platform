import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../core/theme.dart';
import '../state/app_state.dart';
import 'chats/chats_screen.dart';
import 'updates/updates_screen.dart';
import 'communities/communities_screen.dart';
import 'calls/calls_screen.dart';
import 'ai/ai_screen.dart';
import 'settings/settings_screen.dart';

/// Responsive shell: bottom nav on phones, side rail on wide screens.
class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key});

  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _tab = 0;

  static const _dests = [
    (Icons.chat_bubble_rounded, 'Chats'),
    (Icons.donut_large_rounded, 'Updates'),
    (Icons.groups_rounded, 'Communities'),
    (Icons.call_rounded, 'Calls'),
    (Icons.auto_awesome_rounded, 'AI Studio'),
    (Icons.settings_rounded, 'Settings'),
  ];

  Widget _page(int i) => switch (i) {
        0 => const ChatsScreen(),
        1 => const UpdatesScreen(),
        2 => const CommunitiesScreen(),
        3 => const CallsScreen(),
        4 => const AiScreen(),
        _ => const SettingsScreen(),
      };

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.of(context).size.width >= 900;
    final app = context.watch<AppState>();

    if (wide) {
      return Scaffold(
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _tab,
              onDestinationSelected: (i) => setState(() => _tab = i),
              labelType: NavigationRailLabelType.all,
              backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
              selectedIconTheme: const IconThemeData(color: Colors.white),
              selectedLabelTextStyle: const TextStyle(color: Colors.white),
              unselectedIconTheme:
                  IconThemeData(color: Colors.white.withValues(alpha: 0.7)),
              unselectedLabelTextStyle: TextStyle(
                  color: Colors.white.withValues(alpha: 0.7)),
              leading: Padding(
                padding: const EdgeInsets.only(top: 12, bottom: 8),
                child: _avatar(app, 18),
              ),
              destinations: [
                for (final d in _dests)
                  NavigationRailDestination(
                    icon: Icon(d.$1),
                    selectedIcon: Icon(d.$1),
                    label: Text(d.$2),
                  ),
              ],
            ),
            const VerticalDivider(width: 1),
            Expanded(
              child: AnimatedSwitcher(
                duration: 250.ms,
                child: KeyedSubtree(
                  key: ValueKey(_tab),
                  child: _page(_tab),
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      body: AnimatedSwitcher(
        duration: 250.ms,
        child: KeyedSubtree(
          key: ValueKey(_tab),
          child: _page(_tab),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        backgroundColor: Theme.of(context).appBarTheme.backgroundColor,
        indicatorColor: Colors.white.withValues(alpha: 0.2),
        destinations: [
          for (final d in _dests)
            NavigationDestination(
              icon: Icon(d.$1, color: Colors.white.withValues(alpha: 0.8)),
              selectedIcon: Icon(d.$1, color: Colors.white),
              label: d.$2,
            ),
        ],
      ),
    );
  }

  Widget _avatar(AppState app, double radius) {
    final me = app.me;
    final name = (me?['name'] as String?) ?? 'Me';
    final color = AppTheme.avatarColor(me?['avatar_color'] as String? ?? name);
    return CircleAvatar(
      radius: radius,
      backgroundColor: color,
      child: Text(name.isEmpty ? '?' : name[0].toUpperCase(),
          style: const TextStyle(
              color: Colors.white, fontWeight: FontWeight.bold)),
    );
  }
}
