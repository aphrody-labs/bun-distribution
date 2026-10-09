// SPDX-License-Identifier: Apache-2.0
import { defineAphrodyPet } from "../src/element";
import { PET_WEB } from "../src/runtime";

defineAphrodyPet();
const pet = document.querySelector("aphrody-pet");
const status = document.querySelector("#status");
if (!pet || !status) throw new Error("demo markup");

const show = () => (status.textContent = `état : ${pet.state ?? "aucun"}`);
for (const b of document.querySelectorAll<HTMLButtonElement>("#states button")) {
  b.onclick = () => {
    const s = b.dataset.state;
    s ? pet.setState(s) : pet.clearState();
    show();
  };
}
const tracks = document.querySelector("#tracks");
for (const name of Object.keys(PET_WEB.tracks)) {
  const b = document.createElement("button");
  b.textContent = name;
  b.onclick = () => pet.play(name);
  tracks?.append(b);
}
const stop = document.createElement("button");
stop.textContent = "ambiance";
stop.onclick = () => pet.play(null);
tracks?.append(stop);
show();
