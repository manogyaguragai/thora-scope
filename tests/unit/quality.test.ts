import { describe, expect, test } from 'vitest';
import { classifyDevice, qualityOverride } from '../../src/core/quality';

const SWIFTSHADER =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const INTEL = 'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const NVIDIA = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)';
const AMD_IGPU = 'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)';

describe('classifyDevice', () => {
  test('software rasterisers → low', () => {
    expect(classifyDevice({ gpu: SWIFTSHADER, cores: 16, memoryGB: 8 })).toBe('low');
    expect(classifyDevice({ gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)', cores: 8, memoryGB: NaN })).toBe('low');
  });
  test('integrated / unknown → medium', () => {
    expect(classifyDevice({ gpu: INTEL, cores: 8, memoryGB: 8 })).toBe('medium');
    expect(classifyDevice({ gpu: AMD_IGPU, cores: 8, memoryGB: 8 })).toBe('medium');
    expect(classifyDevice({ gpu: '', cores: NaN, memoryGB: NaN })).toBe('medium');
  });
  test('discrete → high, capped by weak CPU/RAM', () => {
    expect(classifyDevice({ gpu: NVIDIA, cores: 8, memoryGB: 8 })).toBe('high');
    expect(classifyDevice({ gpu: NVIDIA, cores: 8, memoryGB: NaN })).toBe('high');
    expect(classifyDevice({ gpu: NVIDIA, cores: 3, memoryGB: 8 })).toBe('medium');
    expect(classifyDevice({ gpu: NVIDIA, cores: 2, memoryGB: 8 })).toBe('low');
    expect(classifyDevice({ gpu: INTEL, cores: 8, memoryGB: 2 })).toBe('low');
  });
});

test('?quality= override', () => {
  expect(qualityOverride(new URLSearchParams('quality=low'))).toBe('low');
  expect(qualityOverride(new URLSearchParams('quality=high'))).toBe('high');
  expect(qualityOverride(new URLSearchParams('quality=ultra'))).toBeNull();
  expect(qualityOverride(new URLSearchParams('quality=toString'))).toBeNull();
  expect(qualityOverride(new URLSearchParams(''))).toBeNull();
});
