class Config {
  // Base URL injected at build time: --dart-define=API_BASE=https://...
  static const apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'https://connect-real-time-me-ghpgxj.drytis.dev',
  );

  static const httpBase = apiBase;
  static const uploadsBase = apiBase;
}
