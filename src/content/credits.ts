// Project credits, shown at the bottom of the help overlay (and in README.md).
// Links open in a new tab only when clicked: nothing is fetched at runtime.
export interface Credit {
  readonly name: string;
  readonly url: string;
}

export const CREDITS_PREFIX = 'Built by';

export const CREDITS: readonly Credit[] = [
  { name: 'Manogya Guragai', url: 'https://www.linkedin.com/in/manogya-guragai' },
  { name: 'Dr. Mandeep Guragai', url: 'https://www.linkedin.com/in/mandeep-guragai-280589117' },
];
