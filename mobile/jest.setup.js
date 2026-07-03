/**
 * Jest setup: swap native storage for the official in-memory mock so the
 * local-first services (auth, repository, store) run unchanged under tests.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
