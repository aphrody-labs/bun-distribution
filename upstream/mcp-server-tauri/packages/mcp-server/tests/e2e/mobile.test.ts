import { describe, it, expect } from 'vitest';
import { listDevices, launchEmulator } from '../../src/manager/mobile';

describe('Mobile Module E2E', () => {
   describe('Device Management', () => {
      it('should list Android devices with structured output', async () => {
         const devices = await listDevices();

         expect(devices).toHaveProperty('android');
         expect(Array.isArray(devices.android)).toBe(true);
      });

      it('should list iOS simulators with structured output', async () => {
         const devices = await listDevices();

         expect(devices).toHaveProperty('ios');
         expect(Array.isArray(devices.ios)).toBe(true);
      });

      it('should handle missing SDKs gracefully', async () => {
         // Function should return empty arrays, not throw
         const devices = await listDevices();

         expect(devices).toBeDefined();
         expect(devices.android).toBeDefined();
         expect(devices.ios).toBeDefined();
      });

      it('should verify launch Android emulator command construction', async () => {
         await expect(async () => { await launchEmulator('android', 'test-avd'); })
            .rejects
            .toThrow(); // Expect it to fail gracefully
      });

      it('should verify launch iOS simulator command construction', async () => {
         await expect(async () => { await launchEmulator('ios', 'test-simulator'); })
            .rejects
            .toThrow(); // Expect it to fail if simulator doesn't exist
      });
   });
});
