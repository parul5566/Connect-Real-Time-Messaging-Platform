import 'package:flutter/material.dart';

/// Chat list placeholder — full implementation in Phase M3.
class ChatsScreen extends StatelessWidget {
  const ChatsScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Connect')),
      body: const Center(child: Text('Chats — Phase M3')),
    );
  }
}
