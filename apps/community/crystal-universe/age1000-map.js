// SPDX-License-Identifier: Apache-2.0
// Original, schematic Age 1000 arena data. No game resources are included.
export const AGE1000_MAP = {
  title: "AGE 1000 — West City",
  width: 1200,
  height: 760,
  areas: [
    { id: "university", label: "Université", x: 70, y: 120, w: 245, h: 210, color: "#315568" },
    { id: "city", label: "Centre urbain", x: 280, y: 160, w: 600, h: 430, color: "#284258" },
    { id: "capsule", label: "Quartier Capsule", x: 830, y: 105, w: 300, h: 230, color: "#35536c" },
    { id: "plaza", label: "Esplanade", x: 870, y: 490, w: 260, h: 180, color: "#274b5c" },
    { id: "glacier", label: "Porte glaciaire", x: 70, y: 505, w: 245, h: 165, color: "#536a79" },
  ],
  landmarks: [
    { id: "university", label: "West City University", x: 115, y: 195, w: 150, h: 86 },
    { id: "squad", label: "Great Saiya Squad", x: 365, y: 190, w: 165, h: 76 },
    { id: "plaza", label: "Central Plaza", x: 565, y: 320, w: 155, h: 100 },
    { id: "capsule", label: "Capsule Complex", x: 900, y: 175, w: 150, h: 90 },
    { id: "monorail", label: "Monorail Station", x: 675, y: 525, w: 135, h: 55 },
    { id: "glacier", label: "Glacier Outpost", x: 115, y: 545, w: 150, h: 75 },
  ],
};

export function drawAge1000Map(ctx, width, height) {
  const sx = width / AGE1000_MAP.width;
  const sy = height / AGE1000_MAP.height;
  ctx.save();
  ctx.scale(sx, sy);
  const sky = ctx.createLinearGradient(0, 0, 0, 760);
  sky.addColorStop(0, "#17334b");
  sky.addColorStop(1, "#172434");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1200, 760);
  ctx.strokeStyle = "rgba(169,212,229,.09)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= 1200; x += 36) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 760);
    ctx.stroke();
  }
  for (let y = 0; y <= 760; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }
  for (const area of AGE1000_MAP.areas) {
    ctx.fillStyle = area.color;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.roundRect(area.x, area.y, area.w, area.h, 26);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px system-ui";
    ctx.fillText(area.label, area.x + 16, area.y + 30);
  }
  ctx.setLineDash([2, 19]);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(159,214,223,.65)";
  ctx.lineWidth = 12;
  for (const [x1, y1, x2, y2] of [
    [260, 238, 565, 355],
    [720, 350, 900, 220],
    [645, 420, 740, 525],
    [675, 550, 265, 575],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const place of AGE1000_MAP.landmarks) {
    ctx.fillStyle = "#111a25";
    ctx.beginPath();
    ctx.roundRect(place.x, place.y, place.w, place.h, 14);
    ctx.fill();
    ctx.strokeStyle = "#81d7df";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "600 15px system-ui";
    ctx.fillText(place.label, place.x + 12, place.y + place.h / 2 + 5, place.w - 24);
  }
  ctx.fillStyle = "#e1eff8";
  ctx.font = "800 24px system-ui";
  ctx.fillText("WEST CITY · AGE 1000", 420, 75);
  ctx.restore();
}
