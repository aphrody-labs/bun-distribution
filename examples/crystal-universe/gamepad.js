// SPDX-License-Identifier: Apache-2.0
export function readGamepadInput(gamepad) {
  if (!gamepad) return { input: {}, startPressed: false };
  const pressed = (index) => Boolean(gamepad.buttons[index]?.pressed);
  const axis = gamepad.axes[0] || 0;
  return {
    input: {
      left: axis < -0.25 || pressed(14),
      right: axis > 0.25 || pressed(15),
      jump: pressed(0),
      punch: pressed(2),
      blast: pressed(1),
      charge: pressed(3),
      transform: pressed(4),
    },
    startPressed: pressed(9),
  };
}
