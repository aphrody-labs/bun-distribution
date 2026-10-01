/**
 * Swipe gesture script - handles touch/mouse swipe actions
 * Falls back to mouse events on desktop environments
 *
 * @param {Object} params
 * @param {number} params.fromX - Starting X coordinate
 * @param {number} params.fromY - Starting Y coordinate
 * @param {number} params.toX - Ending X coordinate
 * @param {number} params.toY - Ending Y coordinate
 * @param {number} params.duration - Duration of swipe in ms
 */
(function(params) {
   const { fromX, fromY, toX, toY, duration } = params;

   const element = document.elementFromPoint(fromX, fromY) || document.body;

   function simulateWithMouse() {
      const mouseDown = new MouseEvent('mousedown', {
         clientX: fromX,
         clientY: fromY,
         bubbles: true,
         cancelable: true,
      });

      const mouseMove = new MouseEvent('mousemove', {
         clientX: toX,
         clientY: toY,
         bubbles: true,
         cancelable: true,
      });

      const mouseUp = new MouseEvent('mouseup', {
         clientX: toX,
         clientY: toY,
         bubbles: true,
         cancelable: true,
      });

      element.dispatchEvent(mouseDown);
      setTimeout(() => {
         element.dispatchEvent(mouseMove);
         element.dispatchEvent(mouseUp);
      }, duration);
   }

   // Check if TouchEvent is available (mobile/touch devices)
   if (typeof TouchEvent !== 'undefined') {
      try {
         const touchStart = new TouchEvent('touchstart', {
            touches: [{
               clientX: fromX,
               clientY: fromY,
               target: element,
            }],
         });

         const touchMove = new TouchEvent('touchmove', {
            touches: [{
               clientX: toX,
               clientY: toY,
               target: element,
            }],
         });

         const touchEnd = new TouchEvent('touchend', {
            changedTouches: [{
               clientX: toX,
               clientY: toY,
               target: element,
            }],
         });

         element.dispatchEvent(touchStart);
         setTimeout(() => {
            element.dispatchEvent(touchMove);
            element.dispatchEvent(touchEnd);
         }, duration);
      } catch (e) {
         // Fallback to mouse events if TouchEvent construction fails
         simulateWithMouse();
      }
   } else {
      // Use mouse events for desktop
      simulateWithMouse();
   }

   return `Swiped from (${fromX}, ${fromY}) to (${toX}, ${toY}) in ${duration}ms`;
})
