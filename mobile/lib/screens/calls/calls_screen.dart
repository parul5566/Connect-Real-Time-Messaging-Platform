import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api.dart';
import '../../core/theme.dart';
import '../../core/call_service.dart';
import 'call_screen.dart';

/// Calls tab: history of past calls with direction, type and duration.
class CallsScreen extends StatefulWidget {
  const CallsScreen({super.key});

  @override
  State<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends State<CallsScreen> {
  List<Map<String, dynamic>>? _calls;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final calls = await Api.getCalls();
      if (!mounted) return;
      setState(() {
        _calls = calls;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = Api.errMsg(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final call = context.watch<CallService>();
    final theme = Theme.of(context);

    // While a call is active, show the live call screen in place of history.
    if (call.phase == CallPhase.incoming ||
        call.phase == CallPhase.outgoing ||
        call.phase == CallPhase.connecting ||
        call.phase == CallPhase.connected) {
      return const CallScreen();
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Calls')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _body(theme),
      ),
    );
  }

  Widget _body(ThemeData theme) {
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.error)),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    final calls = _calls;
    if (calls == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (calls.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.call_rounded,
                size: 64,
                color: theme.colorScheme.primary.withValues(alpha: 0.4)),
            const SizedBox(height: 12),
            const Text(
                'No calls yet.\nStart one from any chat with the call buttons.',
                textAlign: TextAlign.center),
          ],
        ),
      );
    }
    return ListView.separated(
      itemCount: calls.length,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, i) {
        final c = calls[i];
        final other = (c['other'] as Map).cast<String, dynamic>();
        final name = (other['name'] as String?) ?? 'Contact';
        final video = c['type'] == 'video';
        final outgoing = c['direction'] == 'outgoing';
        final status = c['status'] as String?;
        final dur = (c['duration_secs'] as num?)?.toInt() ?? 0;
        final startedAt = DateTime.tryParse(
                (c['started_at'] as String?) ?? '')?.toLocal();
        final color = AppTheme.avatarColor(
            (other['avatar_color'] as String?) ?? name);

        final statusText = switch (status) {
          'declined' => 'Declined',
          'missed' => 'Missed',
          'failed' => 'Failed',
          'completed' when dur > 0 => '${dur ~/ 60}m ${dur % 60}s',
          _ => '—',
        };
        final statusColor = switch (status) {
          'completed' => theme.colorScheme.primary,
          _ => theme.colorScheme.error,
        };

        return ListTile(
          leading: CircleAvatar(
            backgroundColor: color,
            child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ),
          title: Text(name,
              maxLines: 1, overflow: TextOverflow.ellipsis),
          subtitle: Row(
            children: [
              Icon(outgoing ? Icons.call_made_rounded : Icons.call_received_rounded,
                  size: 14,
                  color: status == 'completed'
                      ? theme.colorScheme.primary
                      : theme.colorScheme.error),
              const SizedBox(width: 4),
              Text(statusText,
                  style: TextStyle(color: statusColor, fontSize: 12)),
              if (startedAt != null) ...[
                const SizedBox(width: 8),
                Text(_timeLabel(startedAt),
                    style: TextStyle(
                        color: theme.textTheme.bodySmall?.color,
                        fontSize: 12)),
              ],
            ],
          ),
          trailing: Icon(
              video ? Icons.videocam_rounded : Icons.call_rounded,
              color: theme.colorScheme.primary),
        );
      },
    );
  }

  String _timeLabel(DateTime t) {
    final now = DateTime.now();
    final diff = now.difference(t);
    if (diff.inDays == 0) {
      return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    }
    if (diff.inDays == 1) return 'Yesterday';
    return '${t.day}/${t.month}';
  }
}
