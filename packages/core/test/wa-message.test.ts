import { describe, it, expect } from 'vitest';
import { hasImage, pickText } from '../src/wa-message';

describe('pickText', () => {
  it('conversation', () => expect(pickText({ message: { conversation: 'oi' } })).toBe('oi'));
  it('extendedText', () =>
    expect(pickText({ message: { extendedTextMessage: { text: 'ext' } } })).toBe('ext'));
  it('caption', () =>
    expect(pickText({ message: { imageMessage: { caption: 'cap' } } })).toBe('cap'));
  it('aceita o objeto message direto e vazio', () => {
    expect(pickText({ conversation: 'x' })).toBe('x');
    expect(pickText(null)).toBe('');
    expect(pickText({ message: {} })).toBe('');
  });
});

describe('hasImage', () => {
  it('detecta imageMessage', () => {
    expect(hasImage({ message: { imageMessage: { caption: 'c' } } })).toBe(true);
    expect(hasImage({ message: { conversation: 'x' } })).toBe(false);
    expect(hasImage(null)).toBe(false);
  });
});
