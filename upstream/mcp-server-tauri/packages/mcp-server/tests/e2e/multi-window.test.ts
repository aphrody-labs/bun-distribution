import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { manageWindow } from '../../src/driver/plugin-commands';
import { executeJavaScript, screenshot, interact } from '../../src/driver/webview-interactions';
import { manageDriverSession } from '../../src/driver/session-manager';
import { getTestAppPort } from '../test-utils';

/**
 * E2E tests for multi-window support.
 * Tests the ability to list windows and target specific windows with tools.
 */
describe('Multi-Window Support E2E Tests', () => {
   const TIMEOUT = 10000;

   beforeAll(async () => {
      // App is already started globally - connect to the dynamically assigned port
      await manageDriverSession('start', undefined, getTestAppPort());
   });

   afterAll(async () => {
      await manageDriverSession('stop');
   });

   describe('Window Listing', () => {
      it('should list all windows', async () => {
         const result = await manageWindow({ action: 'list' });

         const parsed = JSON.parse(result);

         expect(parsed).toHaveProperty('windows');
         expect(parsed).toHaveProperty('defaultWindow', 'main');
         expect(parsed).toHaveProperty('totalCount');
         expect(Array.isArray(parsed.windows)).toBe(true);
         expect(parsed.windows.length).toBeGreaterThan(0);
      }, TIMEOUT);

      it('should return window info with expected properties', async () => {
         const result = await manageWindow({ action: 'list' });

         const parsed = JSON.parse(result);

         const mainWindow = parsed.windows.find((w: { label: string }) => { return w.label === 'main'; });

         expect(mainWindow).toBeDefined();
         expect(mainWindow).toHaveProperty('label');
         expect(mainWindow).toHaveProperty('focused');
         expect(mainWindow).toHaveProperty('visible');
         expect(mainWindow).toHaveProperty('isMain', true);
      }, TIMEOUT);
   });

   describe('Window Targeting', () => {
      it('should execute JavaScript in default window when no windowId specified', async () => {
         const result = await executeJavaScript({ script: 'document.title' });

         expect(result).toBeTruthy();
      }, TIMEOUT);

      it('should execute JavaScript in main window when windowId is "main"', async () => {
         const result = await executeJavaScript({ script: 'document.title', windowId: 'main' });

         expect(result).toBeTruthy();
      }, TIMEOUT);

      it('should return error for non-existent window', async () => {
         await expect(executeJavaScript({ script: 'document.title', windowId: 'non-existent-window' }))
            .rejects
            .toThrow(/not found/i);
      }, TIMEOUT);
   });

   describe('Backward Compatibility', () => {
      it('should work with existing tools without windowId', async () => {
         // Test that tools work without windowId (backward compatible)
         const result = await executeJavaScript({ script: '1 + 1' });

         // Result includes window context info
         expect(result).toContain('2');
         expect(result).toContain('[Executed in window: main]');
      }, TIMEOUT);

      it('should take screenshot without windowId', async () => {
         const result = await screenshot({});

         // Result is now a ScreenshotResult with content array (not a file result)
         expect('content' in result).toBe(true);

         if (!('content' in result)) {
            throw new Error('Expected ScreenshotResult with content');
         }

         expect(Array.isArray(result.content)).toBe(true);

         // Should have text and image content
         type ContentItem = { type: string };
         const textContent = result.content.find((c: ContentItem) => { return c.type === 'text'; });

         const imageContent = result.content.find((c: ContentItem) => { return c.type === 'image'; });

         expect(textContent).toBeDefined();
         expect(imageContent).toBeDefined();
      }, TIMEOUT);

      it('should interact without windowId', async () => {
         // Just verify it doesn't throw - actual interaction depends on page content
         const result = await interact({
            action: 'scroll',
            scrollX: 0,
            scrollY: 10,
         });

         expect(result).toBeTruthy();
      }, TIMEOUT);
   });

   describe('Window Resize', () => {
      it('should resize window to specified dimensions', async () => {
         const result = await manageWindow({
            action: 'resize',
            width: 800,
            height: 600,
         });

         const parsed = JSON.parse(result);

         expect(parsed.success).toBe(true);
         expect(parsed.windowLabel).toBe('main');
         expect(parsed.width).toBe(800);
         expect(parsed.height).toBe(600);
      }, TIMEOUT);

      it('should resize window with logical pixels by default', async () => {
         const result = await manageWindow({
            action: 'resize',
            width: 1024,
            height: 768,
         });

         const parsed = JSON.parse(result);

         expect(parsed.success).toBe(true);
         expect(parsed.logical).toBe(true);
      }, TIMEOUT);

      it('should resize specific window by windowId', async () => {
         const result = await manageWindow({
            action: 'resize',
            width: 640,
            height: 480,
            windowId: 'main',
         });

         const parsed = JSON.parse(result);

         expect(parsed.success).toBe(true);
         expect(parsed.windowLabel).toBe('main');
      }, TIMEOUT);
   });

   describe('Window Info', () => {
      it('should get detailed info for main window', async () => {
         const result = await manageWindow({ action: 'info' });

         const parsed = JSON.parse(result);

         expect(parsed).toHaveProperty('width');
         expect(parsed).toHaveProperty('height');
         expect(parsed).toHaveProperty('x');
         expect(parsed).toHaveProperty('y');
         expect(parsed).toHaveProperty('title');
         expect(parsed).toHaveProperty('focused');
         expect(parsed).toHaveProperty('visible');
      }, TIMEOUT);

      it('should get info for specific window by windowId', async () => {
         const result = await manageWindow({ action: 'info', windowId: 'main' });

         const parsed = JSON.parse(result);

         expect(parsed).toHaveProperty('width');
         expect(parsed).toHaveProperty('height');
      }, TIMEOUT);
   });
});
