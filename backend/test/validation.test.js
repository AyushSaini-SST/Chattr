import test from 'node:test';
import assert from 'node:assert/strict';
import { commentInput, loginSchema, postInput, registerSchema } from '../src/utils/validation.js';

test('registration trims and normalizes identity fields', () => {
  const result = registerSchema.safeParse({ username: ' River_7 ', email: ' HELLO@example.com ', displayName: ' River ', password: 'long-enough-password' });
  assert.equal(result.success, true);
  assert.equal(result.data.username, 'river_7');
  assert.equal(result.data.email, 'hello@example.com');
  assert.equal(result.data.displayName, 'River');
});

test('registration rejects weak passwords and invalid usernames', () => {
  assert.equal(registerSchema.safeParse({ username: 'x', email: 'hello@example.com', displayName: 'River', password: 'short' }).success, false);
  assert.equal(registerSchema.safeParse({ username: 'bad name', email: 'hello@example.com', displayName: 'River', password: 'long-enough-password' }).success, false);
});

test('login accepts email or username and refuses empty credentials', () => {
  assert.equal(loginSchema.safeParse({ identifier: 'river', password: 'valid' }).success, true);
  assert.equal(loginSchema.safeParse({ identifier: '', password: '' }).success, false);
});

test('posts default to public and trim text', () => {
  const result = postInput.safeParse({ text: '  hello Chattr  ' });
  assert.equal(result.success, true);
  assert.equal(result.data.text, 'hello Chattr');
  assert.equal(result.data.visibility, 'public');
  assert.equal(postInput.safeParse({ text: 'hello', extra: true }).success, false);
});

test('comments reject blank and oversized text', () => {
  assert.equal(commentInput.safeParse({ text: '  ' }).success, false);
  assert.equal(commentInput.safeParse({ text: 'a'.repeat(1001) }).success, false);
});
